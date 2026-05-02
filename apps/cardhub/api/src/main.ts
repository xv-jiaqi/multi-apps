import 'reflect-metadata';
// Sentry MUST be imported and initialised before any other module that we want
// to trace. Keeping the side-effect import on top guarantees the global hub is
// ready by the time NestFactory.create runs.
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    // Keep traces sampling conservative for the MVP — bump once paid tier
    // is in place.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
}

import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as trpcExpress from '@trpc/server/adapters/express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AppModule } from './app.module';
import { TrpcService } from './trpc/trpc.service';
import { makeCreateContext } from './trpc/context';
import { AuthService } from './modules/auth/auth.service';
import { SentryExceptionFilter } from './common/sentry-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  const config = app.get(ConfigService);
  const trpcService = app.get(TrpcService);
  const authService = app.get(AuthService);

  const corsOrigin = config
    .get<string>('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // helmet hardens HTTP headers (HSTS, X-Frame-Options, etc.). The default
  // contentSecurityPolicy is too strict for the tRPC + JSON workflow during
  // development, so we leave CSP off here and re-enable it in M2.5 once the
  // production frontend origin is known.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Forward unhandled NestJS exceptions to Sentry. Filter is a no-op when
  // SENTRY_DSN is unset so local dev is unaffected.
  app.useGlobalFilters(new SentryExceptionFilter());

  // tRPC procedures live behind Express middleware, so NestJS guards / the
  // ThrottlerGuard do not intercept them. We layer express-rate-limit on the
  // sensitive write paths instead. Reads (queries) stay un-throttled here.
  //
  // Why per-route limiters instead of a single global one: each mutation has
  // a different abuse profile — login attempts deserve a 1-minute window
  // while topic creation deserves a 1-hour window. A single limiter would
  // either be too lax to deter spam or too strict to be usable.
  // ipKeyGenerator collapses IPv6 prefixes so attackers can't rotate the
  // last 64 bits to bypass the limit (the helper is mandatory in
  // express-rate-limit 8.x — see ERR_ERL_KEY_GEN_IPV6). We wrap it so each
  // limiter doesn't have to re-do the `req.ip ?? 'unknown'` dance.
  const ipKey = (req: { ip?: string | undefined }): string => ipKeyGenerator(req.ip ?? 'unknown');

  const authMutationLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: ipKey,
    skip: (req) => {
      const url = req.originalUrl ?? req.url ?? '';
      return !url.includes('auth.register') && !url.includes('auth.login');
    },
  });
  app.use('/trpc', authMutationLimiter);

  // Forum write throttles (M6): 5 topics/hour and 30 replies/hour per IP.
  // The IP is the right surface here because tRPC routes never see the JWT
  // before the limiter runs — promoting these to per-user limits would
  // require moving the check into a tRPC middleware, which is overkill for
  // MVP. A single bad actor behind CGNAT still has to share their bucket
  // with co-tenants, which is fine for the abuse we're modelling (manual
  // spam, not a botnet).
  const forumTopicCreateLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: ipKey,
    skip: (req) => !(req.originalUrl ?? req.url ?? '').includes('forum.topics.create'),
  });
  app.use('/trpc', forumTopicCreateLimiter);

  const forumReplyCreateLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: ipKey,
    skip: (req) => !(req.originalUrl ?? req.url ?? '').includes('forum.replies.create'),
  });
  app.use('/trpc', forumReplyCreateLimiter);

  app.use(
    '/trpc',
    trpcExpress.createExpressMiddleware({
      router: trpcService.appRouter,
      createContext: makeCreateContext(authService),
      // tRPC errors never reach the NestJS exception pipeline, so we wire the
      // Sentry hook here instead. INTERNAL_SERVER_ERROR is the only code we
      // want to alert on; client-side codes (BAD_REQUEST / UNAUTHORIZED / ...)
      // are routine and would just create noise.
      onError: ({ error, path, type }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR' && process.env.SENTRY_DSN) {
          Sentry.captureException(error.cause ?? error, {
            tags: { trpcPath: path ?? 'unknown', trpcType: type },
          });
        }
      },
    }),
  );

  const port = config.get<number>('PORT', 4000);
  await app.listen(port);
  logger.log(`HTTP       ready at http://localhost:${port}`);
  logger.log(`tRPC       ready at http://localhost:${port}/trpc`);
  logger.log(`Health     ready at http://localhost:${port}/health`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
