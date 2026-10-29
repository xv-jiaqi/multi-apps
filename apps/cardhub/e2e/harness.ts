import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(packageDir, '../../..');
export const apiDir = path.join(repoRoot, 'apps/cardhub/api');
export const webDir = path.join(repoRoot, 'apps/cardhub/web');
export const passwordFile = path.join(packageDir, '.auth/passwords.json');
export const ensureDbScript = path.join(packageDir, 'ensure-db.ts');

export const apiPort = 4100;
export const webPort = 4173;
export const apiOrigin = `http://127.0.0.1:${apiPort}`;
export const webOrigin = `http://127.0.0.1:${webPort}`;

export function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export const redisHost = process.env.REDIS_HOST ?? '127.0.0.1';
export const redisPort = Number(process.env.REDIS_PORT ?? '6379');

export const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://cardhub:cardhub@127.0.0.1:5432/cardhub_e2e?schema=public';

export interface DatabaseTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function databaseTarget(): DatabaseTarget {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) {
    throw new Error(`Unsupported smoke database name: ${database}`);
  }
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to quote identifier: ${name}`);
  }
  return `"${name}"`;
}

/** Fresh process each run, so the in-memory rate limiter does not leak across invocations. */
export const apiEnv: Record<string, string> = stringEnv({
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(apiPort),
  DATABASE_URL: databaseUrl,
  JWT_SECRET: 'ci-test-secret',
  JWT_EXPIRES_IN: '1h',
  REDIS_HOST: redisHost,
  REDIS_PORT: String(redisPort),
  CORS_ORIGIN: webOrigin,
  PASSWORD_PREHASH_WRITE: 'false',
  SENTRY_DSN: '',
});
