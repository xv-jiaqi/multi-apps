/**
 * Qoder（ACP 适配器，adapter-acp.md）端到端：真侧车 + 假 ACP Agent（test/fakes/fake-acp.mjs）。
 * 剧本照 Qoder CLI 1.1.80 的实测帧编写；用户默认模式是 yolo，Hub 必须每个会话都切回 default。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentDto,
  ApprovalDto,
  ListEventsResponse,
  TaskWithTurnResponse,
  WaitResponse,
} from '@agent-hub/contract';
import { api, startHub, waitAgentReady, type TestHub } from './helpers/hub';
import { QODER_INIT, QODER_OPTIONS, msg, qoderConfig } from './helpers/qoder-scenario';

type Frame = { method?: string; id?: unknown; params?: Record<string, unknown>; result?: unknown };

function frames(scenario: string, dir: '<-' | '->'): Frame[] {
  const log = `${scenario}.log`;
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith(`${dir} `))
    .map((l) => JSON.parse(l.slice(3)) as Frame);
}

const shell = (id: string, command: string) => ({
  update: {
    sessionUpdate: 'tool_call',
    toolCallId: id,
    title: command,
    kind: 'execute',
    status: 'pending',
    rawInput: { command },
  },
});

/** 第 1 轮：思考、消息、命令（要审批）、输出、计划、用量。 */
const turn1 = {
  then: [
    {
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '看一下提交' },
      },
    },
    msg('我先看看'),
    msg('最近的提交。'),
    shell('call_1', 'git log -3 --oneline'),
    {
      request: 'session/request_permission',
      id: 'perm-1',
      params: {
        toolCall: {
          toolCallId: 'call_1',
          title: 'git log -3 --oneline',
          kind: 'execute',
          rawInput: { command: 'git log -3 --oneline' },
        },
        options: QODER_OPTIONS.filter((o) => o.optionId !== 'proceed_always'),
      },
    },
    {
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_1',
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: 'abc123 add a\ndef456 init\n' } },
        ],
      },
    },
    {
      update: {
        sessionUpdate: 'plan',
        entries: [{ content: '读提交记录', priority: 'medium', status: 'completed' }],
      },
    },
    { update: { sessionUpdate: 'usage_update', used: 1200, size: 200000 } },
    msg('共有 2 个提交。'),
  ],
  reply: { stopReason: 'end_turn' },
};

/** 第 2 轮（追问）：修改文件要审批，人拒绝；Agent 以 failed 结束该工具。 */
const turn2 = {
  then: [
    {
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_2',
        title: 'Edit README.md',
        kind: 'edit',
        status: 'pending',
        locations: [{ path: 'README.md' }],
      },
    },
    {
      request: 'session/request_permission',
      id: 'perm-2',
      params: {
        toolCall: {
          toolCallId: 'call_2',
          title: 'Edit README.md',
          kind: 'edit',
          locations: [{ path: 'README.md' }],
        },
        options: QODER_OPTIONS,
      },
      writeFileIfSelected: { optionId: 'proceed_once', path: 'README.md', content: 'changed\n' },
    },
    { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_2', status: 'failed' } },
    // Agent 自己切到 yolo：Hub 的模式守卫要切回 default。
    { update: { sessionUpdate: 'current_mode_update', currentModeId: 'yolo' } },
    { sleepMs: 200 },
    msg('好的，不改。'),
  ],
  reply: { stopReason: 'end_turn' },
};

/** 第 3 轮：审批挂着时人停止本轮；Agent 收到 session/cancel 后以 cancelled 结束。随后进程退出。 */
const turn3 = {
  then: [
    shell('call_3', 'make deploy'),
    {
      request: 'session/request_permission',
      id: 'perm-3',
      params: {
        toolCall: {
          toolCallId: 'call_3',
          title: 'make deploy',
          kind: 'execute',
          rawInput: { command: 'make deploy' },
        },
        options: QODER_OPTIONS.filter((o) => o.optionId !== 'proceed_always'),
      },
    },
    { awaitNotify: 'session/cancel', timeoutMs: 10_000 },
  ],
  reply: { stopReason: 'cancelled' },
  after: [{ sleepMs: 100 }, { exit: 0 }],
};

/** 第 4 轮：新进程 session/resume 恢复后照常回复；只读任务里写了文件（越界）。 */
const turn4 = {
  then: [msg('恢复后继续。'), { writeFile: 'stray.txt', content: 'x\n' }],
  reply: { stopReason: 'end_turn' },
};

describe('Qoder（ACP）', () => {
  let hub: TestHub;
  let dir: string;
  let scenario: string;
  let taskId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ah-qoder-'));
    scenario = join(dir, 'qoder.json');
    const config = qoderConfig('yolo');
    writeFileSync(
      scenario,
      JSON.stringify({
        initialize: QODER_INIT,
        handlers: {
          'session/new': { reply: config },
          'session/resume': { reply: qoderConfig('yolo') },
          'session/set_config_option': {
            reply: { configOptions: qoderConfig('default').configOptions },
          },
          'session/close': { reply: {} },
          'session/prompt': [turn1, turn2, turn3, turn4],
        },
      }),
    );
    hub = await startHub('codex-readonly-demo', { acpScenario: scenario });
    await waitAgentReady(hub, 'qoder');
  });

  afterAll(async () => {
    await hub?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function pendingApproval(id: string): Promise<ApprovalDto> {
    for (let i = 0; i < 200; i++) {
      const r = await api<{ items: ApprovalDto[] }>(
        hub,
        'GET',
        `/approvals?status=pending&taskId=${id}`,
      );
      if (r.body.items[0]) return r.body.items[0];
      await new Promise((res) => setTimeout(res, 25));
    }
    throw new Error('no pending approval');
  }

  async function events(id: string) {
    return (await api<ListEventsResponse>(hub, 'GET', `/tasks/${id}/events?limit=500`)).body.events;
  }

  it('探测：健康 ready、版本已验证；能力里的模型来自 session/new；探测进程用完即关', async () => {
    const r = await api<{ items: AgentDto[] }>(hub, 'GET', '/agents');
    const q = r.body.items.find((a) => a.id === 'qoder')!;
    expect(q.kind).toBe('acp');
    expect(q.profile).toBe('qoder');
    expect(q.health).toMatchObject({ status: 'ready', version: '1.1.80', versionVerified: true });
    expect(q.capabilities?.sandbox).toBe(false);
    expect(q.capabilities?.resume).toBe(true);
    expect(q.capabilities?.models.map((m) => m.id)).toEqual(['auto', 'performance']);
    expect(frames(scenario, '<-').some((f) => f.method === 'session/close')).toBe(true);
  });

  it('[E14][E15] 只读任务一轮：切回 default 模式、审批 allow_once → proceed_once、事件齐全', async () => {
    const created = await api<TaskWithTurnResponse>(hub, 'POST', '/tasks', {
      agentId: 'qoder',
      prompt: '看看最近的提交',
    });
    expect(created.status).toBe(201);
    taskId = created.body.task.id;
    const approval = await pendingApproval(taskId);
    expect(approval).toMatchObject({
      kind: 'command',
      command: 'git log -3 --oneline',
      options: ['allow_once', 'reject', 'cancel_turn'],
    });
    await api(hub, 'POST', `/approvals/${approval.id}/decision`, { decision: 'allow_once' });
    const end = await api<WaitResponse>(
      hub,
      'GET',
      `/tasks/${taskId}/wait?until=turn_end&timeoutSec=20`,
    );
    expect(end.body.task.status).toBe('completed');

    const sent = frames(scenario, '<-');
    const modeSwitch = sent.findIndex(
      (f) => f.method === 'session/set_config_option' && f.params?.configId === 'mode',
    );
    const prompt = sent.findIndex((f) => f.method === 'session/prompt');
    expect(modeSwitch).toBeGreaterThan(-1);
    expect(sent[modeSwitch]!.params?.value).toBe('default');
    expect(modeSwitch).toBeLessThan(prompt);
    expect(sent.some((f) => f.method === 'authenticate')).toBe(false);
    const permission = sent.find((f) => f.id === 'perm-1');
    expect(permission?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'proceed_once' },
    });

    const ev = await events(taskId);
    const types = ev.map((e) => e.event.type);
    expect(ev.map((e) => e.seq)).toEqual(ev.map((_, i) => i + 1));
    for (const t of [
      'session.started',
      'reasoning.delta',
      'message.delta',
      'tool.started',
      'tool.output.delta',
      'tool.completed',
      'plan.updated',
      'usage.updated',
      'turn.completed',
    ])
      expect(types).toContain(t);
    const started = ev.find((e) => e.event.type === 'tool.started')!.event as Record<
      string,
      unknown
    >;
    expect(started).toMatchObject({
      toolKind: 'command',
      command: 'git log -3 --oneline',
      itemId: 't1-tool-call_1',
    });
    const text = ev
      .filter((e) => e.event.type === 'message.delta')
      .map((e) => (e.event as { text: string }).text)
      .join('');
    expect(text).toBe('我先看看最近的提交。共有 2 个提交。');
  });

  it('[E16] 追问：拒绝修改 → 回 cancel（reject_once），工具记 declined；Agent 自己切到 yolo 被切回', async () => {
    const r = await api(hub, 'POST', `/tasks/${taskId}/turns`, { prompt: '把 README 改一下' });
    expect(r.status).toBe(201);
    const approval = await pendingApproval(taskId);
    expect(approval).toMatchObject({ kind: 'file_change', paths: ['README.md'] });
    expect(approval.options).toEqual(['allow_once', 'reject', 'cancel_turn']);
    await api(hub, 'POST', `/approvals/${approval.id}/decision`, { decision: 'reject' });
    const end = await api<WaitResponse>(
      hub,
      'GET',
      `/tasks/${taskId}/wait?until=turn_end&timeoutSec=20`,
    );
    expect(end.body.task.status).toBe('completed');
    expect(readFileSync(join(hub.repo, 'README.md'), 'utf8')).toBe('# demo\n');
    const sent = frames(scenario, '<-');
    expect(sent.find((f) => f.id === 'perm-2')?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'cancel' },
    });
    const restore = sent.filter(
      (f) => f.method === 'session/set_config_option' && f.params?.value === 'default',
    );
    expect(restore.length).toBeGreaterThanOrEqual(2);
    const ev = await events(taskId);
    const completed = ev.find(
      (e) =>
        e.event.type === 'tool.completed' &&
        (e.event as { itemId: string }).itemId === 't2-tool-call_2',
    );
    expect((completed?.event as { status: string }).status).toBe('declined');
    expect(
      ev.some(
        (e) => e.event.type === 'notice' && (e.event as { code?: string }).code === 'MODE_RESTORED',
      ),
    ).toBe(true);
  });

  it('[E26] 审批挂着时停止本轮：发 session/cancel，挂起的权限请求回 cancelled，任务 cancelled', async () => {
    await api(hub, 'POST', `/tasks/${taskId}/turns`, { prompt: '部署一下' });
    await pendingApproval(taskId);
    const c = await api(hub, 'POST', `/tasks/${taskId}/cancel`, {});
    expect(c.status).toBeLessThan(300);
    const end = await api<WaitResponse>(
      hub,
      'GET',
      `/tasks/${taskId}/wait?until=turn_end&timeoutSec=20`,
    );
    expect(end.body.task.status).toBe('cancelled');
    const sent = frames(scenario, '<-');
    expect(sent.some((f) => f.method === 'session/cancel')).toBe(true);
    expect(sent.find((f) => f.id === 'perm-3')?.result).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    const approvals = await api<{ items: ApprovalDto[] }>(
      hub,
      'GET',
      `/approvals?taskId=${taskId}`,
    );
    expect(approvals.body.items.filter((a) => a.status === 'pending')).toHaveLength(0);
  });

  it('进程退出后追问：新进程 session/resume 恢复同一会话；只读任务写文件 → READ_ONLY_VIOLATION', async () => {
    // 第 3 轮结束后假 Agent 自己退出；等会话被移出活动表。
    await new Promise((r) => setTimeout(r, 500));
    const r = await api(hub, 'POST', `/tasks/${taskId}/turns`, { prompt: '继续' });
    expect(r.status).toBe(201);
    const end = await api<WaitResponse>(
      hub,
      'GET',
      `/tasks/${taskId}/wait?until=turn_end&timeoutSec=20`,
    );
    expect(end.body.task.status).toBe('completed');
    const sent = frames(scenario, '<-');
    const newSession = sent.find((f) => f.method === 'session/new' && f.params?.cwd === hub.repo);
    const resume = sent.find((f) => f.method === 'session/resume');
    expect(resume?.params?.sessionId).toBeDefined();
    expect(newSession).toBeDefined();
    const ev = await events(taskId);
    const resumed = ev.filter((e) => e.event.type === 'session.started').at(-1)!.event as {
      resumed: boolean;
      nativeSessionId: string;
    };
    expect(resumed.resumed).toBe(true);
    expect(resumed.nativeSessionId).toBe(resume!.params!.sessionId);
    expect(
      ev.some(
        (e) =>
          e.event.type === 'notice' &&
          (e.event as { code?: string }).code === 'READ_ONLY_VIOLATION',
      ),
    ).toBe(true);
  });
});

describe('Qoder（ACP）未登录 [E05]', () => {
  let hub: TestHub;
  let dir: string;
  let scenario: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ah-qoder-auth-'));
    scenario = join(dir, 'qoder-auth.json');
    writeFileSync(
      scenario,
      JSON.stringify({
        initialize: QODER_INIT,
        handlers: {
          'session/new': {
            error: {
              code: -32000,
              message: 'Authentication required: Authentication is required.',
            },
          },
        },
      }),
    );
    hub = await startHub('codex-readonly-demo', { acpScenario: scenario });
    await waitAgentReady(hub, 'qoder', 'auth_required');
  });

  afterAll(async () => {
    await hub?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('[E05] 健康 auth_required（Qoder 的登录提示）；任务在准备阶段失败 AGENT_AUTH_REQUIRED；不调 authenticate', async () => {
    const r = await api<{ items: AgentDto[] }>(hub, 'GET', '/agents');
    expect(r.body.items.find((a) => a.id === 'qoder')!.health).toMatchObject({
      status: 'auth_required',
      message: 'Qoder 未登录：请在终端运行 qodercli，按提示登录后重试',
    });
    // local-api.md §POST /tasks 第 3 步：创建不看健康状态，任务在准备阶段失败并带上错误码。
    const created = await api<TaskWithTurnResponse>(hub, 'POST', '/tasks', {
      agentId: 'qoder',
      prompt: 'hi',
    });
    expect(created.status).toBe(201);
    const end = await api<WaitResponse>(
      hub,
      'GET',
      `/tasks/${created.body.task.id}/wait?until=turn_end&timeoutSec=20`,
    );
    expect(end.body.task.status).toBe('failed');
    expect(end.body.task.lastError).toMatchObject({
      code: 'AGENT_AUTH_REQUIRED',
      message: 'Qoder 未登录：请在终端运行 qodercli，按提示登录后重试',
    });
    expect(frames(scenario, '<-').some((f) => f.method === 'authenticate')).toBe(false);
  });
});
