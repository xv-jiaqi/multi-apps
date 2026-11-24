/**
 * testing.md E53 / local-api.md §6.4：task 订阅的客户端不读，待发送数据超过阈值（测试调小）
 * → 以 4008 关闭；带 afterSeq 重连后数据完整（不重不漏）。
 */
import { WS_CLOSE_CODES, type WaitResponse } from '@agent-hub/contract';
import type { Socket } from 'node:net';
import { WebSocket } from 'ws';
import { WsHub } from '../src/api/ws-hub';
import { EventStore } from '../src/core/event-store';
import { api, startHub, waitAgentReady, type TestHub } from './helpers/hub';

const THRESHOLD = 256 * 1024;
const CHUNK = 64 * 1024;
const COUNT = 320; // 约 20 MB，远超阈值和本机回环的内核缓冲

type Msg = { op: string; id?: string; seq?: number; event?: { type: string } };

function connect(hub: TestHub): Promise<{ ws: WebSocket; msgs: Msg[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/api/v1/ws`);
    const msgs: Msg[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as Msg;
      msgs.push(m);
      if (m.op === 'ready') resolve({ ws, msgs });
    });
    ws.on('open', () => ws.send(JSON.stringify({ op: 'auth', token: hub.uiToken })));
    ws.on('error', reject);
  });
}

const until = async (cond: () => boolean, ms = 10_000) => {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('E53 慢消费者', () => {
  let hub: TestHub;

  afterEach(async () => {
    await hub?.close();
  });

  it('task 订阅不读 → 4008 关闭；afterSeq 重连后 seq 连续、不重不漏', async () => {
    hub = await startHub('codex-readonly-demo');
    hub.app.get(WsHub).slowConsumerBytes = THRESHOLD;
    await waitAgentReady(hub);
    const created = await api<{ task: { id: string } }>(hub, 'POST', '/tasks', {
      agentId: 'codex',
      prompt: 'hi',
    });
    const taskId = created.body.task.id;
    await api<WaitResponse>(hub, 'GET', `/tasks/${taskId}/wait?until=turn_end&timeoutSec=20`);

    const { ws, msgs } = await connect(hub);
    ws.send(JSON.stringify({ op: 'subscribe', id: 't', topic: 'task', taskId, afterSeq: 0 }));
    await until(() => msgs.some((m) => m.op === 'event' && m.event?.type === 'turn.completed'));
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));

    // 客户端停止读 socket，然后往这个任务持续写入大事件。
    const socket = (ws as unknown as { _socket: Socket })._socket;
    socket.pause();
    const store = hub.app.get(EventStore);
    for (let i = 0; i < COUNT; i++) {
      store.append(taskId, null, {
        type: 'notice',
        level: 'info',
        message: `${i}:`.padEnd(CHUNK, 'x'),
      });
      if (i % 16 === 0) await new Promise((r) => setImmediate(r));
    }
    const lastSeq = store.list(taskId, 0, 10_000).at(-1)!.seq;

    socket.resume();
    expect(await closed).toBe(WS_CLOSE_CODES.SLOW_CONSUMER);
    const got = msgs
      .filter((m) => m.op === 'event')
      .map((m) => m.seq!)
      .filter((s) => s !== undefined);
    expect(got.length).toBeGreaterThan(0);
    expect(got.at(-1)!).toBeLessThan(lastSeq); // 确实是中途被断开的

    // 重连：afterSeq = 最后收到的 seq，补齐剩下的。
    const again = await connect(hub);
    again.ws.send(
      JSON.stringify({ op: 'subscribe', id: 't', topic: 'task', taskId, afterSeq: got.at(-1) }),
    );
    await until(() => again.msgs.some((m) => m.op === 'event' && m.seq === lastSeq), 20_000);
    const rest = again.msgs.filter((m) => m.op === 'event').map((m) => m.seq!);
    const all = [...got, ...rest];
    expect(all).toEqual(Array.from({ length: lastSeq }, (_, i) => i + 1));
    again.ws.close();
  });

  it('客户端正常读：同样的数据量不会被断开', async () => {
    hub = await startHub('codex-readonly-demo');
    hub.app.get(WsHub).slowConsumerBytes = 4 * 1024 * 1024;
    await waitAgentReady(hub);
    const created = await api<{ task: { id: string } }>(hub, 'POST', '/tasks', {
      agentId: 'codex',
      prompt: 'hi',
    });
    const taskId = created.body.task.id;
    await api<WaitResponse>(hub, 'GET', `/tasks/${taskId}/wait?until=turn_end&timeoutSec=20`);
    const { ws, msgs } = await connect(hub);
    let closeCode: number | null = null;
    ws.on('close', (c) => (closeCode = c));
    ws.send(JSON.stringify({ op: 'subscribe', id: 't', topic: 'task', taskId, afterSeq: 0 }));
    const store = hub.app.get(EventStore);
    for (let i = 0; i < 64; i++) {
      store.append(taskId, null, { type: 'notice', level: 'info', message: 'y'.repeat(CHUNK) });
      await new Promise((r) => setTimeout(r, 2));
    }
    const lastSeq = store.list(taskId, 0, 10_000).at(-1)!.seq;
    await until(() => msgs.some((m) => m.op === 'event' && m.seq === lastSeq));
    expect(closeCode).toBeNull();
    const seqs = msgs.filter((m): m is Msg & { seq: number } => m.op === 'event').map((m) => m.seq);
    expect(seqs).toEqual(Array.from({ length: lastSeq }, (_, i) => i + 1));
    ws.close();
  });
});
