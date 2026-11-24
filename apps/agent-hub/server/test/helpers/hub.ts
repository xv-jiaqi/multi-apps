import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module';
import { httpPipeline } from '../../src/api/http-pipeline';
import { WsHub } from '../../src/api/ws-hub';
import { AuthService } from '../../src/auth/auth.service';
import { HubLogger } from '../../src/common/logger';
import { resolvePaths, type HubPaths } from '../../src/common/paths';
import { HubConfigService } from '../../src/config/config.service';
import { migrate } from '../../src/db/migrations';
import { Db } from '../../src/db/sqlite';
import { Lifecycle } from '../../src/lifecycle';

export const FAKE_CODEX = join(__dirname, '..', 'fakes', 'fake-codex.mjs');
/** 剧本名（test/fakes/scenarios 下）或绝对路径（测试临时生成的剧本）。 */
export const scenarioPath = (name: string) =>
  isAbsolute(name) ? name : join(__dirname, '..', 'fakes', 'scenarios', `${name}.json`);

export interface TestHub {
  app: NestExpressApplication;
  port: number;
  base: string;
  uiToken: string;
  bridgeToken: string;
  repo: string;
  paths: HubPaths;
  db: Db;
  close(): Promise<void>;
}

/** 建一个小 git 仓库作为任务仓库。 */
export function makeRepo(root: string): string {
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.invalid',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.invalid',
      },
    });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# demo\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'add a');
  return repo;
}

/** 起一个完整的侧车（Nest + WS），Codex 指向假 app-server。 */
export async function startHub(
  scenario: string,
  opts: { security?: Record<string, unknown> } = {},
): Promise<TestHub> {
  const root = mkdtempSync(join(tmpdir(), 'ah-codex-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const repo = makeRepo(root);
  process.env.AGENT_HUB_HOME = home;
  process.env.FAKE_SCENARIO = scenarioPath(scenario);
  const paths = resolvePaths(process.env);
  writeFileSync(
    paths.config,
    JSON.stringify({
      agents: [
        {
          id: 'codex',
          kind: 'codex',
          displayName: 'Codex',
          command: FAKE_CODEX,
          args: [],
          envPassthrough: ['FAKE_SCENARIO'],
        },
      ],
      repos: [{ id: 'demo', name: 'demo', path: repo }],
      defaultRepoId: 'demo',
      ...(opts.security ? { security: opts.security } : {}),
    }),
  );
  const logger = new HubLogger(paths);
  const config = new HubConfigService(paths);
  config.loadOrCreate();
  const db = new Db(paths.db);
  migrate(db);
  const auth = new AuthService(db, paths);
  auth.ensureDefaultToken();
  const uiToken = auth.bootstrapUiToken();
  const bridgeToken = readFileSync(paths.bridgeToken, 'utf8').trim();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({ paths, db, logger, config, auth }),
    { logger: false, bodyParser: false },
  );
  app.setGlobalPrefix('api/v1');
  const lifecycle = app.get(Lifecycle);
  const port = 48100 + Math.floor(Math.random() * 800);
  for (const mw of httpPipeline({
    port,
    isShuttingDown: () => lifecycle.isShuttingDown(),
    authenticate: (t) => auth.authenticate(t),
    takeRateToken: (id) => auth.takeRateToken(id),
  })) {
    app.use(mw);
  }
  await app.listen(port, '127.0.0.1');
  app.get(WsHub).attach(app.getHttpServer(), port);
  return {
    app,
    port,
    base: `http://127.0.0.1:${port}/api/v1`,
    uiToken,
    bridgeToken,
    repo,
    paths,
    db,
    async close() {
      await lifecycle.shutdown();
      await app.close();
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function api<T = unknown>(
  hub: TestHub,
  method: string,
  path: string,
  body?: unknown,
  token = hub.uiToken,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${hub.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

/** 等 probe 完成（Agent 健康变为 ready）。 */
export async function waitAgentReady(hub: TestHub): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await api<{ items: { id: string; health: { status: string } }[] }>(
      hub,
      'GET',
      '/agents',
    );
    if (r.body.items.find((a) => a.id === 'codex')?.health.status === 'ready') return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('codex agent not ready');
}
