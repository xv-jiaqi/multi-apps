/**
 * local-api.md §3.4 / security.md §6 / D46：桥接 token 走 REST 拿到的内容全部脱敏；
 * diff 先脱敏再按文件边界截断到 maxBridgeDiffBytes，并记 bridge.diff_read 审计。Hub UI 拿原文。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DiffDto,
  ListEventsResponse,
  TaskResultDto,
  TaskWithTurnResponse,
  WaitResponse,
} from '@agent-hub/contract';
import { listAuditByAction } from '../src/db/repositories/audit.repo';
import { api, scenarioPath, startHub, waitAgentReady, type TestHub } from './helpers/hub';

// 拼出来的假密钥，避免源码里出现完整的密钥字面量。
const SK = ['sk', 'A'.repeat(40)].join('-');
const AKIA = 'AKIA' + 'B'.repeat(16);
const SECRET_LINE = `OPENAI_API_KEY=${SK} aws=${AKIA}`;
const MAX_BRIDGE_DIFF = 512 * 1024;
const BIG_LINE = `${'0123456789abcdef'.repeat(4).slice(0, 63)}\n`; // 64 字节一行
const BIG_LINES = 3500; // 每个文件约 224 KB，三个约 672 KB > 512 KB

function writeScenario(dir: string): string {
  const base = JSON.parse(readFileSync(scenarioPath('codex-readonly-demo'), 'utf8')) as {
    steps: Array<Record<string, unknown>>;
  };
  const ids = { threadId: 'thread_fake_1', turnId: 'turn_fake_1' };
  const steps = [
    ...base.steps.slice(0, 4), // initialize、thread/start、turn/start、turn/started
    { execCommand: ['printf', `${SECRET_LINE}\\n`], itemId: 'cmd_1', ...ids },
    { writeFile: 'a-secrets.env', content: `${SECRET_LINE}\n` },
    { writeFile: 'big1.txt', content: BIG_LINE, repeat: BIG_LINES },
    { writeFile: 'big2.txt', content: BIG_LINE, repeat: BIG_LINES },
    { writeFile: 'big3.txt', content: BIG_LINE, repeat: BIG_LINES },
    {
      notify: 'item/completed',
      params: {
        ...ids,
        item: { type: 'agentMessage', id: 'msg_1', text: `看到了 ${SECRET_LINE}` },
      },
    },
    {
      notify: 'turn/completed',
      params: {
        threadId: ids.threadId,
        turn: { id: ids.turnId, status: 'completed', error: null },
      },
    },
  ];
  const file = join(dir, 'codex-bridge-secrets.json');
  writeFileSync(file, JSON.stringify({ ...base, name: 'codex-bridge-secrets', steps }));
  return file;
}

async function raw(hub: TestHub, path: string, token: string) {
  const res = await fetch(`${hub.base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

describe('桥接方 REST 输出脱敏与 diff 截断（local-api §3.4，D46）', () => {
  let hub: TestHub;
  let dir: string;
  let taskId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ah-bridge-'));
    hub = await startHub(writeScenario(dir));
    await waitAgentReady(hub);
    const created = await api<TaskWithTurnResponse>(
      hub,
      'POST',
      '/tasks',
      { agentId: 'codex', prompt: '看看 .env' },
      hub.bridgeToken,
    );
    expect(created.status).toBe(201);
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

  it('/events：桥接方看不到原文，Hub UI 看得到', async () => {
    const bridge = await raw(hub, `/tasks/${taskId}/events`, hub.bridgeToken);
    expect(bridge.status).toBe(200);
    expect(bridge.text).not.toContain(SK);
    expect(bridge.text).not.toContain(AKIA);
    expect(bridge.text).toContain('«已脱敏»');
    const types = (JSON.parse(bridge.text) as ListEventsResponse).events.map((e) => e.event.type);
    expect(types).toContain('tool.output.delta');

    const ui = await raw(hub, `/tasks/${taskId}/events`, hub.uiToken);
    expect(ui.text).toContain(SK);
    expect(ui.text).toContain(AKIA);
  });

  it('/result 与 /wait：桥接方看不到原文', async () => {
    const result = await api<TaskResultDto>(
      hub,
      'GET',
      `/tasks/${taskId}/result`,
      undefined,
      hub.bridgeToken,
    );
    expect(result.body.turn.finalMessage).toContain('«已脱敏»');
    expect(JSON.stringify(result.body)).not.toContain(SK);
    const wait = await raw(
      hub,
      `/tasks/${taskId}/wait?until=turn_end&timeoutSec=1`,
      hub.bridgeToken,
    );
    expect(wait.text).not.toContain(SK);

    const ui = await api<TaskResultDto>(hub, 'GET', `/tasks/${taskId}/result`);
    expect(ui.body.turn.finalMessage).toContain(SK);
  });

  it('/diff json：先脱敏再按文件截断到 512 KB，truncated=true；记 bridge.diff_read', async () => {
    const before = listAuditByAction(hub.db, 'bridge.diff_read').length;
    const bridge = await api<DiffDto>(
      hub,
      'GET',
      `/tasks/${taskId}/diff`,
      undefined,
      hub.bridgeToken,
    );
    expect(bridge.status).toBe(200);
    const patch = bridge.body.patch ?? '';
    expect(patch).not.toContain(SK);
    expect(patch).not.toContain(AKIA);
    expect(patch).toContain('a-secrets.env');
    expect(patch).toContain('OPENAI_API_KEY=«已脱敏»');
    expect(Buffer.byteLength(patch, 'utf8')).toBeLessThanOrEqual(MAX_BRIDGE_DIFF);
    expect(bridge.body.truncated).toBe(true);
    // 按文件边界截断：最后一个文件没有进来，进来的文件是完整的。
    expect(patch).not.toContain('big3.txt');
    expect(patch.endsWith('\n')).toBe(true);

    const audit = listAuditByAction(hub.db, 'bridge.diff_read');
    expect(audit.length).toBe(before + 1);
    expect(audit[0]!.actor).toMatch(/^bridge:/);
    expect(audit[0]!.task_id).toBe(taskId);
    expect(JSON.parse(audit[0]!.detail!)).toEqual({
      scope: 'task',
      format: 'json',
      bytes: Buffer.byteLength(patch, 'utf8'),
      truncated: true,
    });

    const ui = await api<DiffDto>(hub, 'GET', `/tasks/${taskId}/diff`);
    expect(ui.body.truncated).toBe(false);
    expect(ui.body.patch).toContain(SK);
    expect(ui.body.patch).toContain('big3.txt');
    expect(listAuditByAction(hub.db, 'bridge.diff_read').length).toBe(before + 1); // UI 不记
  });

  it('/diff?format=patch：桥接方补丁脱敏、截断，响应头 X-Agent-Hub-Truncated: true', async () => {
    const bridge = await raw(hub, `/tasks/${taskId}/diff?format=patch`, hub.bridgeToken);
    expect(bridge.status).toBe(200);
    expect(bridge.headers.get('content-type')).toContain('text/x-diff');
    expect(bridge.headers.get('x-agent-hub-truncated')).toBe('true');
    expect(bridge.text).not.toContain(SK);
    expect(bridge.text).toContain('OPENAI_API_KEY=«已脱敏»');
    expect(Buffer.byteLength(bridge.text, 'utf8')).toBeLessThanOrEqual(MAX_BRIDGE_DIFF);
    const audit = listAuditByAction(hub.db, 'bridge.diff_read');
    expect(JSON.parse(audit[0]!.detail!)).toMatchObject({ format: 'patch', truncated: true });

    const ui = await raw(hub, `/tasks/${taskId}/diff?format=patch`, hub.uiToken);
    expect(ui.headers.get('x-agent-hub-truncated')).toBe('false');
    expect(ui.text).toContain(SK);
  });
});
