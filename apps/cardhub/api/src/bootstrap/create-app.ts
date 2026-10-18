import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import * as trpcExpress from '@trpc/server/adapters/express';
import type { RequestHandler, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from '../app.module';
import { SentryExceptionFilter } from '../common/sentry-exception.filter';
import { AuthService } from '../modules/auth/auth.service';
import { PrismaService } from '../modules/prisma/prisma.service';
import { TrpcService } from '../trpc/trpc.service';
import { makeCreateContext } from '../trpc/context';
import { configureApp } from './configure-app';
import { jsonBodyParser } from './json-body';
import { createRateLimiters, type RateLimitOverrides } from './rate-limiters';

export type CreateAppOptions = {
  rateLimitOverrides?: RateLimitOverrides;
};

function splitVary(
  value: ReturnType<Response['getHeader']> | Parameters<Response['setHeader']>[1],
) {
  if (!value) {
    return [];
  }
  return (Array.isArray(value) ? value.join(',') : String(value))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeVaryHeader(
  existing: ReturnType<Response['getHeader']>,
  next: Parameters<Response['setHeader']>[1],
): string {
  const values = new Map<string, string>();
  for (const item of [...splitVary(existing), ...splitVary(next)]) {
    const key = item.toLowerCase();
    if (!values.has(key)) {
      values.set(key, item);
    }
  }
  return [...values.values()].join(', ');
}

const preserveExistingVaryHeader: RequestHandler = (_req, res, next) => {
  const setHeader = res.setHeader.bind(res);

  res.setHeader = ((name, value) => {
    if (String(name).toLowerCase() === 'vary') {
      return setHeader(name, mergeVaryHeader(res.getHeader('vary'), value));
    }
    return setHeader(name, value);
  }) as Response['setHeader'];

  next();
};

export async function createApp(options: CreateAppOptions = {}) {
  // bodyParser is replaced by jsonBodyParser so catalog import can accept a
  // 1MB procedure input plus 16KB of tRPC batch envelope, without raising the
  // 100kb cap on every other route.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  configureApp(app);

  const config = app.get(ConfigService);
  const trpcService = app.get(TrpcService);
  const authService = app.get(AuthService);
  const prisma = app.get(PrismaService);

  const corsOrigin = config
    .get<string>(
      'CORS_ORIGIN',
      'http://localhost:5173,http://localhost:10086,https://card-hub.app,https://staging.card-hub.app,tauri://localhost,https://tauri.localhost',
    )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // helmet hardens HTTP headers (HSTS, X-Frame-Options, etc.). The default
  // contentSecurityPolicy is too strict for the tRPC + JSON workflow during
  // development, so we leave CSP off here and re-enable it once the production
  // frontend origin policy is ready to be locked down.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.enableCors({
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      callback(null, origin ? corsOrigin.includes(origin) : false);
    },
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

  for (const { path, middleware } of createRateLimiters(options.rateLimitOverrides)) {
    app.use(path, middleware);
  }

  app.use(jsonBodyParser());
  app.use('/trpc', preserveExistingVaryHeader);
  app.use(
    '/trpc',
    trpcExpress.createExpressMiddleware({
      router: trpcService.appRouter,
      createContext: makeCreateContext(authService, prisma),
      onError: ({ error, path, type }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR' && process.env.SENTRY_DSN) {
          Sentry.captureException(error.cause ?? error, {
            tags: { trpcPath: path ?? 'unknown', trpcType: type },
          });
        }
      },
    }),
  );

  return app;
}
