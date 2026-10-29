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

// Before routers and env schemas. Object schemas call `new Function` unless jitless is already set.
import './configure-zod';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createApp } from './bootstrap/create-app';
import { installHttpDrain } from './bootstrap/graceful-shutdown';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  // Own SIGTERM/SIGINT handling: drain first, then app.close() runs Nest's
  // resource hooks. enableShutdownHooks() would re-send the signal on exit.
  installHttpDrain(app);
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
