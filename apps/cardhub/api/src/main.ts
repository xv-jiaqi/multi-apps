import 'reflect-metadata';
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

  // tRPC procedures live behind Express middleware, so NestJS guards / the
  // ThrottlerGuard do not intercept them. We layer express-rate-limit on the
  // sensitive auth-mutation paths instead. Reads (queries) stay un-throttled
  // here; per-procedure throttling for comments / forum posts will be added
  // alongside the tRPC middleware that owns those routers.
  const authMutationLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // ipKeyGenerator collapses IPv6 prefixes so attackers can't rotate the
    // last 64 bits to bypass the limit (the helper is mandatory in
    // express-rate-limit 8.x — see ERR_ERL_KEY_GEN_IPV6).
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    skip: (req) => {
      const url = req.originalUrl ?? req.url ?? '';
      return !url.includes('auth.register') && !url.includes('auth.login');
    },
  });
  app.use('/trpc', authMutationLimiter);

  app.use(
    '/trpc',
    trpcExpress.createExpressMiddleware({
      router: trpcService.appRouter,
      createContext: makeCreateContext(authService),
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
