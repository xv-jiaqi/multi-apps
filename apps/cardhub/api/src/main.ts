import 'reflect-metadata';
// Sentry MUST be imported and initialised before any other module that we want
// to trace. Keeping the side-effect import on top guarantees the global hub is
// ready by the time NestFactory.create runs.
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.GIT_SHA?.trim() || undefined,
    // Keep traces sampling conservative for the MVP — bump once paid tier
    // is in place.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
}

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createApp } from './bootstrap/create-app';
import { installHttpDrain } from './bootstrap/graceful-shutdown';
import { PrismaService } from './modules/prisma/prisma.service';
import { RedisService } from './modules/redis/redis.service';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  // onModuleDestroy disconnects Prisma and Redis before Nest closes the
  // socket. Drain first so an in-flight request still has those clients.
  app.enableShutdownHooks();
  installHttpDrain(app, [app.get(PrismaService), app.get(RedisService)]);
  const logger = new Logger('Bootstrap');

  const config = app.get(ConfigService);

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
