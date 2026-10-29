import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NativeLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import * as trpcExpress from '@trpc/server/adapters/express';
import type { RequestHandler, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from '../app.module';
import { SentryExceptionFilter } from '../common/sentry-exception.filter';
import { attachRequestLogging } from './http-logger';
import { REQUEST_ID_HEADER_NAME, requestIdFrom } from './request-id';
import { AuthService } from '../modules/auth/auth.service';
import { PrismaService } from '../modules/prisma/prisma.service';
import {
  catalogCacheHeaderEnabled,
  createCacheHeaderReporter,
  observeCacheHeader,
} from '../modules/redis/cache-header';
import { RedisService } from '../modules/redis/redis.service';
import { TrpcService } from '../trpc/trpc.service';
import { makeCreateContext } from '../trpc/context';
import { DEFAULT_CORS_ORIGIN } from '../modules/seo/public-web-origin';
import { configureApp } from './configure-app';
import { jsonBodyParser } from './json-body';
import { createRateLimiters, type RateLimitOverrides } from './rate-limiters';

export type CreateAppOptions = {
  rateLimitOverrides?: RateLimitOverrides;
  /** Overrides the Redis key prefix. Tests pass one prefix to share a bucket. */
  rateLimitPrefix?: string;
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
  // NativeLogger keeps Nest's (message, stack, context) call shape and writes
  // JSON through the request-scoped pino child, so every line has requestId.
  app.useLogger(app.get(NativeLogger));
  // bufferLogs holds Nest lines until flush. listen() flushes too late for
  // tests that only call init(), and too late for the lines emitted while
  // the app is still starting.
  app.flushLogs();
  configureApp(app);
  // Before helmet and the JSON parser, so a 400/413 still gets a request id.
  attachRequestLogging(app);

  const config = app.get(ConfigService);
  const trpcService = app.get(TrpcService);
  const authService = app.get(AuthService);
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);

  const corsOrigin = config
    .get<string>('CORS_ORIGIN', DEFAULT_CORS_ORIGIN)
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
    exposedHeaders: [REQUEST_ID_HEADER_NAME],
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

  for (const { path, middleware } of createRateLimiters(
    redis,
    options.rateLimitOverrides,
    options.rateLimitPrefix,
  )) {
    app.use(path, middleware);
  }

  app.use(jsonBodyParser());
  const catalogCacheHeader: RequestHandler = (_req, res, next) => {
    if (!catalogCacheHeaderEnabled()) {
      next();
      return;
    }
    observeCacheHeader(
      createCacheHeaderReporter((status) => {
        if (!res.headersSent) res.setHeader('X-Cache', status);
      }),
      () => {
        next();
      },
    );
  };

  app.use('/trpc', preserveExistingVaryHeader);
  app.use('/trpc', catalogCacheHeader);
  app.use(
    '/trpc',
    trpcExpress.createExpressMiddleware({
      router: trpcService.appRouter,
      createContext: makeCreateContext(authService, prisma),
      onError: ({ error, path, type, req }) => {
        const requestId = requestIdFrom(req);
        // requestId is already a child binding on req.log. Repeating it here
        // writes a second key into the raw JSON line.
        const fields = {
          trpcPath: path ?? 'unknown',
          trpcType: type,
          code: error.code,
        };
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          req.log.error(fields, 'tRPC request failed');
          if (process.env.SENTRY_DSN) {
            const tags: Record<string, string> = {
              trpcPath: path ?? 'unknown',
              trpcType: type,
            };
            if (requestId) tags.request_id = requestId;
            Sentry.captureException(error.cause ?? error, { tags });
          }
          return;
        }
        req.log.warn(fields, 'tRPC request rejected');
      },
    }),
  );

  return app;
}
