/**
 * 审查 6040751657：密钥被切在两条增量事件里时，桥接方不能拿到明文或可拼回密钥的片段。
 * 复现：命令输出先给「OPENAI_API_KEY=sk- 加 10 个字符」，300 ms 后（超过 200 ms 的增量缓冲）再给剩下 30 个字符；
 * 回复消息同样切开。桥接方 REST /events 和 WS 都要检查；UI token 看到的原文不变。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  HubEventEnvelope,
  ListEventsResponse,
  TaskWithTurnResponse,
  WaitResponse,
} from '@agent-hub/contract';
import { WebSocket } from 'ws';
import { api, scenarioPath, startHub, waitAgentReady, type TestHub } from './helpers/hub';

// 拼出来的假密钥，源码里没有完整字面量。
const BODY = 'Q7'.repeat(20); // 40 个字符
const KEY = ['sk', BODY].join('-');
const HEAD = `OPENAI_API_KEY=sk-${BODY.slice(0, 10)}`;
const TAIL = `${BODY.slice(10)}\n`;
/** 密钥主体里任意 8 个连续字符都不该出现在桥接方拿到的文本里。 */
const FRAGMENTS = Array.from({ length: BODY.length - 7 }, (_, i) => BODY.slice(i, i + 8));

function writeScenario(dir: string): string {
  const base = JSON.parse(readFileSync(scenarioPath('codex-readonly-demo'), 'utf8')) as {
    steps: Array<Record<string, unknown>>;
  };
  const ids = { threadId: 'thread_fake_1', turnId: 'turn_fake_1' };
  const cmd = {
    type: 'commandExecution',
    id: 'cmd_1',
    command: 'cat .env',
    cwd: '/tmp',
    status: 'inProgress',
    exitCode: null,
    durationMs: null,
  };
  const out = (delta: string) => ({
    notify: 'item/commandExecution/outputDelta',
    params: { ...ids, itemId: 'cmd_1', delta },
  });
  const msg = (delta: string) => ({
    notify: 'item/agentMessage/delta',
    params: { ...ids, itemId: 'msg_1', delta },
  });
  const steps = [
    ...base.steps.slice(0, 4), // initialize、thread/start、turn/start、turn/started
    { notify: 'item/started', params: { ...ids, item: cmd } },
    out('DEBUG=1\n'),
    out(HEAD),
    { sleepMs: 300 },
    out(TAIL),
    { sleepMs: 300 },
    {
      notify: 'item/completed',
      params: { ...ids, item: { ...cmd, status: 'completed', exitCode: 0, durationMs: 5 } },
    },
    msg('文件里有 '),
    msg(HEAD),
    { sleepMs: 300 },
    msg(`${BODY.slice(10)} 这一行。`),
    { sleepMs: 300 },
    {
      notify: 'item/completed',
      params: {
        ...ids,
        item: {
          type: 'agentMessage',
          id: 'msg_1',
          text: `文件里有 ${HEAD}${BODY.slice(10)} 这一行。`,
        },
      },
    },
    base.steps.at(-1)!, // turn/completed
  ];
  const file = join(dir, 'codex-split-secret.json');
  writeFileSync(file, JSON.stringify({ ...base, name: 'codex-split-secret', steps }));
  return file;
}

type DeltaEv = { type: string; itemId?: string; text?: string };

/** 同一 item 的增量文本拼起来。 */
function joined(events: Array<{ event: DeltaEv }>, type: string, itemId: string): string {
  return events
    .filter((e) => e.event.type === type && e.event.itemId === itemId)
    .map((e) => e.event.text ?? '')
    .join('');
}

function expectNoSecret(text: string): void {
  expect(text).not.toContain(KEY);
  for (const f of FRAGMENTS) expect(text).not.toContain(f);
}

describe('桥接方：跨增量切开的密钥（审查 6040751657）', () => {
  let hub: TestHub;
  let dir: string;
  let taskId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ah-split-'));
    hub = await startHub(writeScenario(dir));
    await waitAgentReady(hub);
    const created = await api<TaskWithTurnResponse>(
      hub,
      'POST',
      '/tasks',
      { agentId: 'codex', prompt: '看看 .env' },
      hub.bridgeToken,
    );
    taskId = created.body.task.id;
    const end = await api<WaitResponse>(
      hub,
      'GET',
      `/tasks/${taskId}/wait?until=turn_end&timeoutSec=20`,
      undefined,
      hub.bridgeToken,
    );
    expect(end.body.task.status).toBe('completed');
  });

  afterAll(async () => {
    await hub?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('REST /events：桥接方拼起来也没有密钥或其片段；UI 拼起来是原文；seq 连续', async () => {
    const bridge = await api<ListEventsResponse>(
      hub,
      'GET',
      `/tasks/${taskId}/events?limit=500`,
      undefined,
      hub.bridgeToken,
    );
    const ev = bridge.body.events as Array<HubEventEnvelope & { event: DeltaEv }>;
    expect(ev.map((e) => e.seq)).toEqual(ev.map((_, i) => i + 1));
    const tool = joined(ev, 'tool.output.delta', 'cmd_1');
    const message = joined(ev, 'message.delta', 'msg_1');
    expectNoSecret(tool);
    expectNoSecret(message);
    expect(tool).toBe('DEBUG=1\nOPENAI_API_KEY=«已脱敏»\n');
    expect(message).toBe('文件里有 OPENAI_API_KEY=«已脱敏» 这一行。');
    expectNoSecret(JSON.stringify(bridge.body));

    const ui = await api<ListEventsResponse>(hub, 'GET', `/tasks/${taskId}/events?limit=500`);
    const uiEv = ui.body.events as Array<HubEventEnvelope & { event: DeltaEv }>;
    expect(uiEv.map((e) => e.seq)).toEqual(ev.map((e) => e.seq));
    expect(joined(uiEv, 'tool.output.delta', 'cmd_1')).toBe(`DEBUG=1\n${HEAD}${TAIL}`);
    expect(joined(uiEv, 'message.delta', 'msg_1')).toBe(
      `文件里有 ${HEAD}${BODY.slice(10)} 这一行。`,
    );
  });

  it('WS（桥接 token，afterSeq=0 回放）：同样没有密钥或其片段', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/api/v1/ws`);
    const msgs: Array<{ op: string; seq?: number; event?: DeltaEv }> = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ op: 'auth', token: hub.bridgeToken }));
    const deadline = Date.now() + 10_000;
    while (!msgs.some((m) => m.op === 'ready')) {
      if (Date.now() > deadline) throw new Error('ready timeout');
      await new Promise((r) => setTimeout(r, 20));
    }
    ws.send(JSON.stringify({ op: 'subscribe', id: 't', topic: 'task', taskId, afterSeq: 0 }));
    while (!msgs.some((m) => m.op === 'event' && m.event?.type === 'turn.completed')) {
      if (Date.now() > deadline) throw new Error('events timeout');
      await new Promise((r) => setTimeout(r, 20));
    }
    ws.close();
    const ev = msgs.filter((m) => m.op === 'event') as Array<{ seq: number; event: DeltaEv }>;
    expectNoSecret(joined(ev, 'tool.output.delta', 'cmd_1'));
    expectNoSecret(joined(ev, 'message.delta', 'msg_1'));
    expectNoSecret(JSON.stringify(msgs));
  });
});
