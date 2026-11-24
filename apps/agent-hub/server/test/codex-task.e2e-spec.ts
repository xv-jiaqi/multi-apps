import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ApprovalDto,
  DiffDto,
  HubEventEnvelope,
  ListEventsResponse,
  TaskResultDto,
  TaskWithTurnResponse,
  WaitResponse,
} from '@agent-hub/contract';
import { WebSocket } from 'ws';
import { api, startHub, waitAgentReady, type TestHub } from './helpers/hub';

async function dispatch(hub: TestHub, prompt: string, token?: string) {
  const r = await api<TaskWithTurnResponse>(
    hub,
    'POST',
    '/tasks',
    { agentId: 'codex', prompt },
    token,
  );
  expect(r.status).toBe(201);
  expect(r.body.task.mode).toBe('read_only');
  expect(r.body.task.workspace).toBe('in_place');
  return r.body.task.id;
}

async function waitEnd(hub: TestHub, id: string): Promise<WaitResponse> {
  const r = await api<WaitResponse>(hub, 'GET', `/tasks/${id}/wait?until=turn_end&timeoutSec=20`);
  expect(r.body.reached).toBe(true);
  return r.body;
}

describe('PR2 Codex 只读任务（假 app-server）', () => {
  let hub: TestHub;

  afterEach(async () => {
    await hub?.close();
  });

  it('派发 → completed；事件、输出流、结果与 diff 齐全；仓库不变', async () => {
    hub = await startHub('codex-readonly-demo');
    await waitAgentReady(hub);
    const id = await dispatch(hub, '看看最近 3 个提交，只读。', hub.bridgeToken);
    const end = await waitEnd(hub, id);
    expect(end.task.status).toBe('completed');
    expect(end.task.nativeSessionId).toBe('thread_fake_1');

    const ev = await api<ListEventsResponse>(hub, 'GET', `/tasks/${id}/events`);
    const types = ev.body.events.map((e) => e.event.type);
    expect(types).toEqual([
      'task.status',
      'session.started',
      'task.status',
      'turn.started',
      'reasoning.delta',
      'reasoning.completed',
      'tool.started',
      'tool.output.delta',
      'tool.completed',
      'message.delta',
      'message.completed',
      'usage.updated',
      'diff.updated',
      'turn.completed',
      'task.status',
    ]);
    const seqs = ev.body.events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const out = ev.body.events.find((e) => e.event.type === 'tool.output.delta')!.event as {
      text: string;
    };
    expect(out.text).toContain('add a'); // 真实 git log 输出

    const result = await api<TaskResultDto>(hub, 'GET', `/tasks/${id}/result`);
    expect(result.body.turn.finalMessage).toContain('只读任务');
    expect(result.body.turn.usage?.totalTokens).toBe(1234);
    expect(result.body.readOnlyViolation).toBe(false);

    const diff = await api<DiffDto>(hub, 'GET', `/tasks/${id}/diff`);
    expect(diff.body.stats.filesChanged).toBe(0);
    expect(diff.body.patch).toBe('');
  });

  it('WS：ready 后订阅 task，回放全部事件；tasks 主题收到对象变化', async () => {
    hub = await startHub('codex-readonly-demo');
    await waitAgentReady(hub);
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/api/v1/ws`);
    const msgs: Array<
      { op: string; id?: string } & Partial<HubEventEnvelope> & { task?: { status: string } }
    > = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ op: 'auth', token: hub.uiToken }));
    await new Promise((r) => setTimeout(r, 100));
    expect(msgs[0]?.op).toBe('ready');
    ws.send(JSON.stringify({ op: 'subscribe', id: 'list', topic: 'tasks' }));
    const id = await dispatch(hub, 'hi');
    ws.send(
      JSON.stringify({
        op: 'subscribe',
        id: 't1',
        topic: 'task',
        taskId: id.slice(0, 8),
        afterSeq: 0,
      }),
    );
    await waitEnd(hub, id);
    await new Promise((r) => setTimeout(r, 300));
    const events = msgs.filter((m) => m.op === 'event' && m.id === 't1');
    expect(events.map((m) => m.event!.type)).toContain('turn.completed');
    expect(new Set(events.map((m) => m.seq)).size).toBe(events.length);
    const taskMsgs = msgs.filter((m) => m.op === 'task' && m.id === 'list');
    expect(taskMsgs.map((m) => m.task!.status)).toContain('completed');
    ws.close();
  });

  it('审批 allow_once 后 Agent 写文件 → diff 有改动，只读越界告警', async () => {
    hub = await startHub('codex-readonly-violation');
    await waitAgentReady(hub);
    const id = await dispatch(hub, 'write');
    let approval: ApprovalDto | undefined;
    for (let i = 0; i < 100 && !approval; i++) {
      const r = await api<{ items: ApprovalDto[] }>(
        hub,
        'GET',
        `/approvals?status=pending&taskId=${id}`,
      );
      approval = r.body.items[0];
      if (!approval) await new Promise((res) => setTimeout(res, 50));
    }
    expect(approval?.kind).toBe('file_change');
    const decided = await api<ApprovalDto>(hub, 'POST', `/approvals/${approval!.id}/decision`, {
      decision: 'allow_once',
    });
    expect(decided.body.status).toBe('approved');
    const end = await waitEnd(hub, id);
    expect(end.task.readOnlyViolation).toBe(true);
    const diff = await api<DiffDto>(hub, 'GET', `/tasks/${id}/diff`);
    expect(diff.body.stats.files.map((f) => f.path).sort()).toEqual(['NOTES.md', 'OOPS.txt']);
    expect(diff.body.patch).toContain('+agent wrote this');
    expect(existsSync(join(hub.repo, 'NOTES.md'))).toBe(true);
  });

  it('审批 reject → 只有越界写的文件', async () => {
    hub = await startHub('codex-readonly-violation');
    await waitAgentReady(hub);
    const id = await dispatch(hub, 'write');
    let approval: ApprovalDto | undefined;
    for (let i = 0; i < 100 && !approval; i++) {
      const r = await api<{ items: ApprovalDto[] }>(
        hub,
        'GET',
        `/approvals?status=pending&taskId=${id}`,
      );
      approval = r.body.items[0];
      if (!approval) await new Promise((res) => setTimeout(res, 50));
    }
    await api(hub, 'POST', `/approvals/${approval!.id}/decision`, { decision: 'reject' });
    await waitEnd(hub, id);
    const diff = await api<DiffDto>(hub, 'GET', `/tasks/${id}/diff?scope=turn&turn=1`);
    expect(diff.body.stats.files.map((f) => f.path)).toEqual(['OOPS.txt']);
  });

  it('Agent 不存在 404；缺 tasks:write 403', async () => {
    hub = await startHub('codex-readonly-demo');
    const r = await api(hub, 'POST', '/tasks', { agentId: 'nope', prompt: 'x' });
    expect(r.status).toBe(404);
    const tok = await api<{ token: string }>(hub, 'POST', '/tokens', {
      name: 'ro',
      scopes: ['tasks:read'],
    });
    const denied = await api<{ error: { code: string } }>(
      hub,
      'POST',
      '/tasks',
      { agentId: 'codex', prompt: 'x' },
      tok.body.token,
    );
    expect(denied.body.error.code).toBe('FORBIDDEN_SCOPE');
  });
});
