import 'reflect-metadata';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX } from '@agent-hub/contract';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { httpPipeline } from './api/http-pipeline';
import { WsHub } from './api/ws-hub';
import { AuthService } from './auth/auth.service';
import { HubLogger } from './common/logger';
import { resolvePaths, type HubPaths } from './common/paths';
import { HubConfigService } from './config/config.service';
import { migrate, MigrationError } from './db/migrations';
import { Db } from './db/sqlite';
import { Lifecycle } from './lifecycle';
import { SERVER_VERSION } from './version';

interface Fatal {
  event: 'fatal';
  code: string;
  message: string;
}

function fatal(code: string, message: string): never {
  const line: Fatal = { event: 'fatal', code, message };
  process.stdout.write(`${JSON.stringify(line)}\n`);
  process.exit(1);
}

function ensureNodeVersion(): void {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if ((maj ?? 0) < 22 || ((maj ?? 0) === 22 && (min ?? 0) < 13)) {
    fatal('NODE_TOO_OLD', `需要 Node.js ≥ 22.13，当前 ${process.versions.node}`);
  }
}

function ensureHome(paths: HubPaths): void {
  try {
    mkdirSync(paths.home, { recursive: true, mode: 0o700 });
    chmodSync(paths.home, 0o700);
    for (const dir of [paths.logs, paths.transcripts, paths.worktrees, paths.guard, paths.probe]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(`${paths.lock}.probe`, 'ok', { mode: 0o600 });
    unlinkSync(`${paths.lock}.probe`);
  } catch (err) {
    fatal('HOME_NOT_WRITABLE', `无法写入 AGENT_HUB_HOME：${(err as Error).message}`);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function healthOk(port: number): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 1000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${API_PREFIX}/health`, { signal: ac.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { app?: string };
    return body.app === 'agent-hub';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function acquireLock(paths: HubPaths, port: number): Promise<void> {
  if (existsSync(paths.lock)) {
    try {
      const prev = JSON.parse(readFileSync(paths.lock, 'utf8')) as { pid?: number; port?: number };
      if (
        typeof prev.pid === 'number' &&
        isPidAlive(prev.pid) &&
        typeof prev.port === 'number' &&
        (await healthOk(prev.port))
      ) {
        fatal('ALREADY_RUNNING', `侧车已在运行（pid ${prev.pid}, port ${prev.port}）`);
      }
    } catch {
      // overwrite broken lock
    }
  }
  const payload = { pid: process.pid, port, startedAt: new Date().toISOString() };
  const tmp = `${paths.lock}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  renameSync(tmp, paths.lock);
}

function parseArgs(argv: string[]): { lifelineStdin: boolean } {
  let lifelineStdin = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lifeline' && argv[i + 1] === 'stdin') {
      lifelineStdin = true;
      i += 1;
    }
  }
  return { lifelineStdin };
}

async function bootstrap(): Promise<void> {
  ensureNodeVersion();
  const args = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(process.env);
  ensureHome(paths);

  const logger = new HubLogger(paths);
  const configSvc = new HubConfigService(paths);
  let config;
  try {
    config = configSvc.loadOrCreate();
  } catch (err) {
    fatal('CONFIG_INVALID', err instanceof Error ? err.message : String(err));
  }

  const port = Number(process.env.AGENT_HUB_PORT || config.server.port);
  logger.setLevel(config.diagnostics.logLevel);
  await acquireLock(paths, port);

  let db: Db;
  try {
    db = new Db(paths.db);
  } catch (err) {
    fatal('DB_OPEN_FAILED', `打开数据库失败：${(err as Error).message}`);
  }

  try {
    migrate(db);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fatal(
      'DB_MIGRATION_FAILED',
      err instanceof MigrationError ? `${message}（备份目录：${paths.home}）` : message,
    );
  }

  const auth = new AuthService(db, paths);
  try {
    auth.ensureDefaultToken();
  } catch (err) {
    fatal('STARTUP_FAILED', `初始化默认桥接 token 失败：${(err as Error).message}`);
  }
  const uiToken = auth.bootstrapUiToken();

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({ paths, db, logger, config: configSvc, auth }),
    { logger, bodyParser: false },
  );
  app.setGlobalPrefix('api/v1');

  const lifecycle = app.get(Lifecycle);
  for (const mw of httpPipeline({
    port,
    isShuttingDown: () => lifecycle.isShuttingDown(),
    authenticate: (token) => auth.authenticate(token),
    takeRateToken: (tokenId) => auth.takeRateToken(tokenId),
  })) {
    app.use(mw);
  }

  let shuttingDown = false;
  const triggerShutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      await lifecycle.shutdown();
      try {
        await app.close();
      } catch {
        // ignore
      }
      try {
        db.close();
      } catch {
        // ignore
      }
      try {
        unlinkSync(paths.lock);
      } catch {
        // ignore
      }
      process.exit(0);
    })();
  };

  process.on('SIGTERM', triggerShutdown);
  process.on('SIGINT', triggerShutdown);
  if (args.lifelineStdin) {
    process.stdin.resume();
    process.stdin.on('end', triggerShutdown);
    process.stdin.on('close', triggerShutdown);
  }

  try {
    await app.listen(port, '127.0.0.1');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') fatal('PORT_IN_USE', `端口 ${port} 已被占用`);
    fatal('STARTUP_FAILED', err instanceof Error ? err.message : String(err));
  }

  const httpServer = app.getHttpServer() as HttpServer;
  app.get(WsHub).attach(httpServer, port);

  process.stdout.write(
    `${JSON.stringify({
      event: 'ready',
      port,
      uiToken,
      version: SERVER_VERSION,
      pid: process.pid,
    })}\n`,
  );

  if (process.env.AGENT_HUB_DEV === '1') {
    process.stderr.write(`Hub UI: http://localhost:5174/#uiToken=${uiToken}\n`);
  }
}

bootstrap().catch((err) => {
  fatal('STARTUP_FAILED', err instanceof Error ? err.message : String(err));
});
