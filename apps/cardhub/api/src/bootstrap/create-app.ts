import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import * as trpcExpress from '@trpc/server/adapters/express';
import helmet from 'helmet';
import { AppModule } from '../app.module';
import { SentryExceptionFilter } from '../common/sentry-exception.filter';
import { AuthService } from '../modules/auth/auth.service';
import { TrpcService } from '../trpc/trpc.service';
import { makeCreateContext } from '../trpc/context';
import { configureApp } from './configure-app';
import { createRateLimiters, type RateLimitOverrides } from './rate-limiters';

export type CreateAppOptions = {
  rateLimitOverrides?: RateLimitOverrides;
};

export async function createApp(options: CreateAppOptions = {}) {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);

  const config = app.get(ConfigService);
  const trpcService = app.get(TrpcService);
  const authService = app.get(AuthService);

  const corsOrigin = config
    .get<string>(
      'CORS_ORIGIN',
      'http://localhost:5173,http://localhost:10086,https://card-hub.app,https://staging.card-hub.app,tauri://localhost,https://tauri.localhost',
    )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

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

  app.useGlobalFilters(new SentryExceptionFilter());

  for (const { path, middleware } of createRateLimiters(options.rateLimitOverrides)) {
    app.use(path, middleware);
  }

  app.use(
    '/trpc',
    trpcExpress.createExpressMiddleware({
      router: trpcService.appRouter,
      createContext: makeCreateContext(authService),
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
