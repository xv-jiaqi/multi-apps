import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ensureDatabase } from './ensure-db.ts';
import {
  apiDir,
  databaseUrl,
  passwordFile,
  redisHost,
  redisPort,
  repoRoot,
  webDir,
} from './harness';

const requiredBuilds = [path.join(apiDir, 'dist/main.js'), path.join(webDir, 'dist/index.html')];

function assertBuilds(): void {
  const missing = requiredBuilds.filter((file) => !existsSync(file));
  if (missing.length === 0) return;
  const relative = missing.map((file) => path.relative(repoRoot, file)).join(', ');
  throw new Error(
    `Missing ${relative}. Build first: pnpm exec turbo run build --filter=@cardhub/api --filter=@cardhub/web`,
  );
}

function assertRedis(): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: redisHost, port: redisPort });
    let settled = false;
    const timer = setTimeout(() => {
      settle(new Error('timed out'));
    }, 2_000);

    function settle(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (!error) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Redis is not accepting connections at ${redisHost}:${redisPort}. Start it before the smoke test.`,
          { cause: error },
        ),
      );
    }

    socket.once('connect', () => settle());
    socket.once('error', (error) => settle(error));
  });
}

function runApi(script: string, env: NodeJS.ProcessEnv): void {
  execFileSync(
    'pnpm',
    ['--filter', '@cardhub/api', '--fail-if-no-match', 'exec', 'pnpm', 'run', script],
    {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      timeout: 180_000,
    },
  );
}

export default async function globalSetup(): Promise<void> {
  assertBuilds();
  await assertRedis();
  await ensureDatabase();

  const userPassword = randomBytes(18).toString('base64url');
  const adminPassword = randomBytes(18).toString('base64url');
  mkdirSync(path.dirname(passwordFile), { recursive: true });
  writeFileSync(passwordFile, JSON.stringify({ userPassword, adminPassword }), { mode: 0o600 });

  const seedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DEMO_USER_PASSWORD: userPassword,
    DEMO_ADMIN_PASSWORD: adminPassword,
    PASSWORD_PREHASH_WRITE: 'false',
  };
  runApi('db:migrate:deploy', seedEnv);
  runApi('db:seed', seedEnv);
  console.info('Playwright smoke database is migrated and demo users are seeded.');
}
