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
import { listeningPort } from './ports';

export const FAKE_CODEX = join(__dirname, '..', 'fakes', 'fake-codex.mjs');
export const FAKE_ACP = join(__dirname, '..', 'fakes', 'fake-acp.mjs');
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

/** 起一个完整的侧车（Nest + WS），Codex 指向假 app-server；可选再配一个指向假 ACP Agent 的 Qoder。 */
export async function startHub(
  scenario: string,
  opts: {
    security?: Record<string, unknown>;
    /** 配一个 Qoder（kind acp，profile qoder），命令是 fake-acp.mjs，剧本是这个绝对路径。 */
    acpScenario?: string;
  } = {},
): Promise<TestHub> {
  const root = mkdtempSync(join(tmpdir(), 'ah-codex-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const repo = makeRepo(root);
  process.env.AGENT_HUB_HOME = home;
  process.env.FAKE_SCENARIO = scenarioPath(scenario);
  if (opts.acpScenario) process.env.FAKE_ACP_SCENARIO = opts.acpScenario;
  const paths = resolvePaths(process.env);
  mkdirSync(paths.probe, { recursive: true });
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
        ...(opts.acpScenario
          ? [
              {
                id: 'qoder',
                kind: 'acp',
                profile: 'qoder',
                displayName: 'Qoder',
                command: FAKE_ACP,
                args: [],
                envPassthrough: ['FAKE_ACP_SCENARIO'],
              },
            ]
          : []),
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
  // 端口交给系统分配（listen(0)），并行套件不会撞端口。Host 校验按实际端口，所以 deps.port 是 getter，
  // 中间件在 listen 之前挂上、请求到来时才读。
  let port = 0;
  for (const mw of httpPipeline({
    get port() {
      return port;
    },
    isShuttingDown: () => lifecycle.isShuttingDown(),
    authenticate: (t) => auth.authenticate(t),
    takeRateToken: (id) => auth.takeRateToken(id),
  })) {
    app.use(mw);
  }
  try {
    await app.listen(0, '127.0.0.1');
  } catch (e) {
    // 起不来时把已经打开的东西关掉，否则 jest worker 退不干净，还会把真正的错误淹掉。
    await app.close().catch(() => undefined);
    db.close();
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
  port = listeningPort(app.getHttpServer());
  app.get(WsHub).attach(app.getHttpServer(), port);
  let closed = false;
  return {
    app,
    port,
    base: `http://127.0.0.1:${port}/api/v1`,
    uiToken,
    bridgeToken,
    repo,
    paths,
    db,
    /** 可以重复调用：afterEach 里关上一个测试留下的 hub 时，不会因为重复关闭报 “database is not open”。 */
    async close() {
      if (closed) return;
      closed = true;
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

/** 等 probe 完成（Agent 健康变为 status，默认 ready）。 */
export async function waitAgentReady(
  hub: TestHub,
  agentId = 'codex',
  status = 'ready',
): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await api<{ items: { id: string; health: { status: string } }[] }>(
      hub,
      'GET',
      '/agents',
    );
    if (r.body.items.find((a) => a.id === agentId)?.health.status === status) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`${agentId} agent not ${status}`);
}
