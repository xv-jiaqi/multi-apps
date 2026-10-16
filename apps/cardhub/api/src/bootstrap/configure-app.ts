import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { configureTrustProxy } from './trust-proxy';

export function configureApp(app: INestApplication): Express {
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  configureTrustProxy(expressApp);
  return expressApp;
}
