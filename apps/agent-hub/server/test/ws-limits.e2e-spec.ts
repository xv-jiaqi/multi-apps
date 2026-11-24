/**
 * PR3 待办 2、3（PR #310 审查）：
 * - 桥接 token 的 8 连接上限在鉴权成功时计数：用 auth 消息鉴权的连接也算，第 9 个以 4429 关闭；
 * - 回放读库失败不留下未处理的 rejection：记日志并以 1011 关闭，客户端带 afterSeq 重连即可。
 */
import { WS_CLOSE_CODES, type WaitResponse } from '@agent-hub/contract';
import { WebSocket } from 'ws';
import { EventStore } from '../src/core/event-store';
import { api, startHub, waitAgentReady, type TestHub } from './helpers/hub';

type Opened = { ws: WebSocket; first: Promise<{ op: string }>; closed: Promise<number> };

function open(hub: TestHub, token: string, viaHeader = false): Opened {
  const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/api/v1/ws`, {
    headers: viaHeader ? { Authorization: `Bearer ${token}` } : {},
  });
  const first = new Promise<{ op: string }>((resolve) =>
    ws.once('message', (d) => resolve(JSON.parse(String(d)) as { op: string })),
  );
  const closed = new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
  ws.on('error', () => undefined);
  if (!viaHeader) ws.on('open', () => ws.send(JSON.stringify({ op: 'auth', token })));
  return { ws, first, closed };
}

describe('WebSocket 连接上限与回放出错（PR3）', () => {
  let hub: TestHub;

  beforeAll(async () => {
    hub = await startHub('codex-readonly-demo');
    await waitAgentReady(hub);
  });
  afterAll(async () => {
    await hub?.close();
  });

  it('桥接 token：8 个连接用 auth 消息鉴权后，第 9 个 auth 消息 → 4429；header 握手 → 429', async () => {
    const conns = Array.from({ length: 8 }, () => open(hub, hub.bridgeToken));
    for (const c of conns) expect((await c.first).op).toBe('ready');

    const ninth = open(hub, hub.bridgeToken);
    expect(await ninth.closed).toBe(WS_CLOSE_CODES.TOO_MANY_CONNECTIONS);

    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/api/v1/ws`, {
        headers: { Authorization: `Bearer ${hub.bridgeToken}` },
      });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => undefined);
    });
    expect(status).toBe(429);

    // UI token 不受限；关掉一个桥接连接后又能连上。
    const ui = open(hub, hub.uiToken);
    expect((await ui.first).op).toBe('ready');
    conns[0]!.ws.close();
    await conns[0]!.closed;
    const again = open(hub, hub.bridgeToken);
    expect((await again.first).op).toBe('ready');
    for (const c of [...conns.slice(1), ui, again]) c.ws.close();
  });

  it('回放读库失败 → 以 1011 关闭，侧车照常工作', async () => {
    const created = await api<{ task: { id: string } }>(hub, 'POST', '/tasks', {
      agentId: 'codex',
      prompt: 'hi',
    });
    const taskId = created.body.task.id;
    await api<WaitResponse>(hub, 'GET', `/tasks/${taskId}/wait?until=turn_end&timeoutSec=20`);

    const store = hub.app.get(EventStore);
    const spy = jest.spyOn(store, 'list').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    const c = open(hub, hub.uiToken);
    expect((await c.first).op).toBe('ready');
    c.ws.send(JSON.stringify({ op: 'subscribe', id: 's', topic: 'task', taskId, afterSeq: 0 }));
    expect(await c.closed).toBe(WS_CLOSE_CODES.INTERNAL_ERROR);
    spy.mockRestore();

    // 重连照常回放。
    const d = open(hub, hub.uiToken);
    await d.first;
    const seqs: number[] = [];
    d.ws.on('message', (m) => {
      const msg = JSON.parse(String(m)) as { op: string; seq?: number };
      if (msg.op === 'event') seqs.push(msg.seq!);
    });
    d.ws.send(JSON.stringify({ op: 'subscribe', id: 's', topic: 'task', taskId, afterSeq: 0 }));
    const last = store.list(taskId, 0, 10_000).at(-1)!.seq;
    for (let i = 0; i < 200 && seqs.at(-1) !== last; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(seqs).toEqual(Array.from({ length: last }, (_, i) => i + 1));
    d.ws.close();
  });
});
