#!/usr/bin/env node
/**
 * 真实 Qoder 验收（testing.md §7.1）。在已经装好并登录 qodercli 的机器上跑，不进 CI。
 *
 *   pnpm --filter @agent-hub/server build
 *   node scripts/qoder-acceptance/run.mjs [输出文件]
 *
 * 环境变量：
 *   QODER_CMD   qodercli 的路径（默认在 PATH 里找 qodercli）
 *   QODER_ARGS  启动参数，空格分隔（默认 --acp）
 *   QODER_ENV_PASSTHROUGH  额外透传给 Agent 的环境变量名，逗号分隔（只给假 Agent 演练用）
 *   KEEP=1      结束后保留临时目录
 *   ACC_IDLE_WAIT_SEC  A9 等闲置超时的秒数（默认 80；Agent 的 idleTimeoutMinutes 设成 1）
 *
 * 脚本自己起一个临时的侧车（临时 AGENT_HUB_HOME、临时 git 仓库、系统分配的空闲端口），不碰本机正在用的
 * Hub；不替用户登录 Qoder（未登录时在第 1 步停下，提示去终端登录）。所有 token 在输出里打码。
 * 每一步打印 PASS / FAIL / CHECK（CHECK = 需要人看一眼的输出），最后汇总；有 FAIL 时退出码 1。
 */
import { spawn, execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  appendFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRV = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT =
  process.argv[2] ?? join(SRV, `qoder-acceptance-${new Date().toISOString().slice(0, 10)}.txt`);
const red = (s) =>
  String(s)
    .replace(/(ahu|ahb|aht)_[A-Za-z0-9_-]{20,}/g, '$1_<redacted>')
    .replace(/"uiToken":"[^"]*"/g, '"uiToken":"<redacted>"');
writeFileSync(OUT, '');
const log = (...a) => {
  const line = red(a.join(' '));
  console.info(line);
  appendFileSync(OUT, `${line}\n`);
};
const results = [];
const step = (id, status, note) => {
  results.push({ id, status, note });
  log(`[${status}] ${id}${note ? ` — ${note}` : ''}`);
};

function which(cmd) {
  try {
    return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
const QODER = process.env.QODER_CMD || which('qodercli');
const ARGS = (process.env.QODER_ARGS ?? '--acp').split(' ').filter(Boolean);
if (!QODER) {
  log('找不到 qodercli：先在这台机器上安装并登录 Qoder CLI，或用 QODER_CMD 指定路径。');
  process.exit(2);
}
if (!existsSync(join(SRV, 'dist', 'main.js'))) {
  log('缺少 dist/main.js：先跑 pnpm --filter @agent-hub/server build');
  process.exit(2);
}

const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

const H = mkdtempSync(join(tmpdir(), 'ah-qoder-acc-'));
const HOME = join(H, 'home');
const REPO = join(H, 'repo');
execFileSync('mkdir', ['-p', HOME, REPO]);
execFileSync('chmod', ['700', HOME]);
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' });
git('init', '-q');
writeFileSync(join(REPO, 'README.md'), '# acceptance\n\n第一行以外的内容。\n');
git('add', '.');
git('-c', 'user.name=acc', '-c', 'user.email=acc@example.invalid', 'commit', '-q', '-m', 'init');
const passthrough = (process.env.QODER_ENV_PASSTHROUGH ?? '').split(',').filter(Boolean);
writeFileSync(
  join(HOME, 'config.json'),
  JSON.stringify({
    agents: [
      {
        id: 'qoder',
        kind: 'acp',
        profile: 'qoder',
        displayName: 'Qoder',
        command: QODER,
        args: ARGS,
        idleTimeoutMinutes: 1,
        ...(passthrough.length ? { envPassthrough: passthrough } : {}),
      },
    ],
    repos: [{ id: 'acc-repo', name: 'acc-repo', path: REPO }],
    defaultRepoId: 'acc-repo',
  }),
);

let port = 0;
let hub = null;
let ui = '';
let bridge = '';
async function startHub() {
  port = await freePort();
  hub = spawn(process.execPath, [join(SRV, 'dist', 'main.js')], {
    cwd: SRV,
    env: { ...process.env, AGENT_HUB_HOME: HOME, AGENT_HUB_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  ui = await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('侧车 20 秒内没有 ready')), 20_000);
    hub.stdout.on('data', (d) => {
      buf += d;
      for (const l of buf.split('\n')) {
        if (l.includes('"event":"ready"')) {
          clearTimeout(t);
          ok(JSON.parse(l).uiToken);
        }
        if (l.includes('"event":"fatal"')) {
          clearTimeout(t);
          fail(new Error(l));
        }
      }
    });
  });
  bridge = readFileSync(join(HOME, 'bridge-token'), 'utf8').trim();
}
async function stopHub() {
  if (!hub) return null;
  const p = hub;
  hub = null;
  return new Promise((ok) => {
    p.on('exit', (code) => ok(code));
    p.kill('SIGTERM');
  });
}
async function api(method, path, body, token = bridge) {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(method === 'POST' && /\/(tasks|turns)$/.test(path)
        ? { 'idempotency-key': `acc:${Date.now()}:${Math.random()}` }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 非 JSON
  }
  return { status: res.status, json, text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = () => {
  try {
    return execFileSync('pgrep', ['-P', String(hub?.pid ?? 0)], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
};

/** 跑一轮：遇到审批按 policy 决定（'allow_once' / 'reject' / null = 不该有审批），直到这一轮结束。 */
async function runTurn(taskId, policy, timeoutSec = 240) {
  const decided = [];
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const pend = await api('GET', `/approvals?status=pending&taskId=${taskId}`);
    for (const a of pend.json?.items ?? []) {
      const decision = policy ?? 'reject';
      decided.push({
        kind: a.kind,
        title: a.title ?? a.summary ?? '',
        options: a.options,
        decision,
      });
      const r = await api('POST', `/approvals/${a.id}/decision`, { decision }, ui);
      log(
        `  审批 ${a.kind ?? ''} “${a.title ?? a.summary ?? ''}” → ${decision}（HTTP ${r.status}）`,
      );
    }
    const w = await api('GET', `/tasks/${taskId}/wait?until=turn_end&timeoutSec=3`);
    if (w.json?.reached) return { task: w.json.task, decided };
  }
  return { task: null, decided };
}
const events = async (taskId, after = 0) =>
  (await api('GET', `/tasks/${taskId}/events?afterSeq=${after}&limit=1000`)).json?.events ?? [];
const lastText = (evs) =>
  evs
    .filter((e) => e.event.type === 'message.completed')
    .map((e) => e.event.text)
    .at(-1) ?? '';

try {
  log(`# ${new Date().toString()} 真实 Qoder 验收  qoder=${QODER} ${ARGS.join(' ')}`);
  try {
    log(
      `qodercli --version: ${execFileSync(QODER, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim()}`,
    );
  } catch (e) {
    log(`qodercli --version 失败：${e.message}`);
  }
  log(`node ${process.version}  ${execFileSync('uname', ['-sr'], { encoding: 'utf8' }).trim()}`);
  await startHub();
  log(`侧车 ready，端口 ${port}（临时目录 ${H}）`);

  // A1 健康
  let agent = null;
  for (let i = 0; i < 60; i++) {
    agent = (await api('GET', '/agents')).json?.items?.find((a) => a.id === 'qoder');
    if (
      agent &&
      ['ready', 'auth_required', 'unavailable', 'error'].includes(
        agent.health?.status ?? agent.status,
      )
    )
      break;
    await sleep(500);
  }
  log(`GET /agents qoder: ${JSON.stringify(agent)}`);
  const status = agent?.health?.status ?? agent?.status;
  if (status === 'auth_required') {
    step(
      'A1 健康',
      'FAIL',
      'auth_required：请先在终端运行 qodercli 登录，再重跑本脚本（脚本不替你登录）',
    );
    throw new Error('stop');
  }
  step('A1 健康为 ready、版本已核对', status === 'ready' ? 'PASS' : 'FAIL', `status=${status}`);
  step(
    'A2 模型与推理档位',
    'CHECK',
    '对照 Qoder 客户端里的模型列表看上面的 capabilities（首个会话后才有，见 A3 之后的输出）',
  );

  // A3 只读任务
  const created = await api('POST', '/tasks', {
    agentId: 'qoder',
    prompt: '列出这个仓库根目录下的文件名，只读，不要修改任何文件，也不要运行命令。',
  });
  const taskId = created.json?.task?.id;
  log(`POST /tasks → ${created.status} task=${taskId}`);
  let r = await runTurn(taskId, 'reject');
  let evs = await events(taskId);
  log(`  最后一条回复：${lastText(evs).slice(0, 300)}`);
  step(
    'A3 只读任务出结果',
    r.task?.status && lastText(evs) ? 'PASS' : 'FAIL',
    `status=${r.task?.status}`,
  );
  const agent2 = (await api('GET', '/agents')).json?.items?.find((a) => a.id === 'qoder');
  log(`  capabilities（会话之后）：${JSON.stringify(agent2?.capabilities ?? agent2)}`);
  const modeEv = evs
    .filter((e) => e.event.type === 'notice')
    .map((e) => `${e.event.code}:${e.event.message}`);
  log(`  notice：${JSON.stringify(modeEv)}`);
  step(
    'A3b 模式守卫（D37、D38）',
    'CHECK',
    '会话应显式切到 default；若 Qoder 设置里默认是 yolo，应看到 MODE_RESTORED',
  );

  // A4 命令审批：批准
  let seq = evs.at(-1)?.seq ?? 0;
  await api('POST', `/tasks/${taskId}/turns`, {
    prompt: '请运行 git log --oneline -1，把输出原样告诉我。',
  });
  r = await runTurn(taskId, 'allow_once');
  evs = await events(taskId, seq);
  log(`  审批：${JSON.stringify(r.decided)}`);
  log(`  回复：${lastText(evs).slice(0, 300)}`);
  const cmdApproved = r.decided.some((d) => d.kind === 'command');
  step(
    'A4 命令审批（批准一次）',
    cmdApproved ? 'PASS' : 'CHECK',
    cmdApproved ? '' : '没有出现命令审批：确认 default 模式下命令是否本来就询问',
  );

  // A5 修改审批：拒绝；仓库保持干净
  seq = evs.at(-1)?.seq ?? seq;
  await api('POST', `/tasks/${taskId}/turns`, { prompt: '把 README.md 的第一行改成 hello。' });
  r = await runTurn(taskId, 'reject');
  const dirty = git('status', '--porcelain').trim();
  log(`  审批：${JSON.stringify(r.decided)}；git status --porcelain：${JSON.stringify(dirty)}`);
  step('A5 修改审批（拒绝）后仓库干净', r.decided.length > 0 && !dirty ? 'PASS' : 'FAIL');

  // A6 模型与推理档位切换
  const caps = agent2?.capabilities;
  const current = r.task?.model ?? caps?.models?.find((m) => m.isDefault)?.id;
  const target =
    caps?.models?.find((m) => m.id !== current && !m.isDefault) ??
    caps?.models?.find((m) => m.id !== current);
  const model = target?.id;
  const effort = target?.reasoningEfforts?.at(-1)?.id;
  seq = (await events(taskId)).at(-1)?.seq ?? seq;
  const fu = await api('POST', `/tasks/${taskId}/turns`, {
    prompt: '只回答“好”。',
    ...(model ? { model } : {}),
    ...(effort ? { reasoningEffort: effort } : {}),
  });
  r = await runTurn(taskId, 'reject');
  log(
    `  切到 model=${model} effort=${effort}：HTTP ${fu.status}，任务 model=${r.task?.model} effort=${r.task?.reasoningEffort}`,
  );
  step(
    'A6 模型与推理档位切换',
    model && r.task?.model === model && (!effort || r.task?.reasoningEffort === effort)
      ? 'PASS'
      : 'CHECK',
    '另请在 Qoder 客户端或日志里确认实际生效',
  );

  // A7 停止本轮
  seq = (await events(taskId)).at(-1)?.seq ?? seq;
  await api('POST', `/tasks/${taskId}/turns`, {
    prompt: '从 1 数到 300，每个数字单独一行，不要省略。',
  });
  await sleep(4000);
  const c = await api('POST', `/tasks/${taskId}/cancel`, {});
  r = await runTurn(taskId, 'reject', 60);
  log(`  cancel → HTTP ${c.status}；任务状态 ${r.task?.status}`);
  step('A7 停止本轮', r.task ? 'PASS' : 'FAIL', `status=${r.task?.status}`);

  // A8 侧车重启后恢复
  const before = children().length;
  const code = await stopHub();
  log(`  SIGTERM 侧车 exit=${code}；停之前子进程 ${before} 个`);
  await startHub();
  seq = (await events(taskId)).at(-1)?.seq ?? 0;
  await api('POST', `/tasks/${taskId}/turns`, { prompt: '我们第一轮里你列出了哪些文件？' });
  r = await runTurn(taskId, 'reject');
  evs = await events(taskId, seq);
  const started = evs.find((e) => e.event.type === 'session.started')?.event;
  log(`  session.started：${JSON.stringify(started)}；回复：${lastText(evs).slice(0, 300)}`);
  step(
    'A8 重启后恢复会话',
    started?.resumed === true ? 'PASS' : 'FAIL',
    '回复里应能说出第一轮的文件名',
  );

  // A9 闲置超时后进程不在（idleTimeoutMinutes=1）
  const idleWait = Number(process.env.ACC_IDLE_WAIT_SEC ?? 80);
  log(`  等 ${idleWait} 秒看闲置超时……`);
  await sleep(idleWait * 1000);
  const left = children();
  step(
    'A9 闲置超时后 qodercli 进程不在',
    left.length === 0 ? 'PASS' : 'FAIL',
    `剩余子进程 ${left.length}`,
  );

  // A10 桥接方看到的输出里没有 Hub token
  const all = (await api('GET', `/tasks/${taskId}/events?limit=1000`)).text;
  step('A10 桥接响应里没有 Hub token', /ah[ub]_[A-Za-z0-9_-]{43}/.test(all) ? 'FAIL' : 'PASS');
} catch (e) {
  if (e.message !== 'stop') step('脚本异常', 'FAIL', e.stack ?? String(e));
} finally {
  const code = await stopHub();
  log(`侧车退出码 ${code}`);
  log('');
  log('## 汇总');
  for (const x of results) log(`${x.status.padEnd(5)} ${x.id}`);
  log(`输出：${OUT}`);
  if (process.env.KEEP !== '1') rmSync(H, { recursive: true, force: true });
  process.exitCode = results.some((x) => x.status === 'FAIL') ? 1 : 0;
}
