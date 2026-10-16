import type { Express } from 'express';

export function configureTrustProxy(app: Express): void {
  // The API sits behind exactly one Caddy reverse-proxy hop. This lets Express
  // derive req.ip from the real client IP while ignoring spoofed extra
  // X-Forwarded-For entries. Do not change this to `true`.
  app.set('trust proxy', 1);
}
