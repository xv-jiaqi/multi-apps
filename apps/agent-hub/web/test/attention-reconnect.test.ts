import { WS_CLOSE_CODES } from '@agent-hub/contract';
import { AttentionWatcher } from '../src/api/attention-watcher';
import { createSocket, type SocketLike } from '../src/api/socket';
import { isRecord } from '../src/lib/guard';
import { approval, envelope, task } from './fixtures';

class FakeSocket implements SocketLike {
  static sockets: FakeSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {
    FakeSocket.sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }
}

function ready(socket: FakeSocket): void {
  socket.onopen?.();
  socket.onmessage?.({
    data: JSON.stringify({ op: 'ready', kind: 'ui', scopes: ['tasks:read'], admin: true }),
  });
}

function taskAfterSeqs(socket: FakeSocket): number[] {
  const seqs: number[] = [];
  for (const line of socket.sent) {
    const message: unknown = JSON.parse(line);
    if (!isRecord(message)) continue;
    if (message.op !== 'subscribe' || message.topic !== 'task') continue;
    if (typeof message.afterSeq !== 'number') continue;
    seqs.push(message.afterSeq);
  }
  return seqs;
}

describe('重连后的通知', () => {
  beforeEach(() => {
    FakeSocket.sockets = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('重连后不重复通知，4008 按退避重连并且不超过 10 秒', () => {
    const hub = createSocket((url) => new FakeSocket(url));
    const notify = vi.fn();
    const watcher = new AttentionWatcher({
      subscribeTask: (taskId, handlers) => hub.subscribeTask(taskId, handlers),
      notify,
      isBackground: () => true,
      agentDisplayName: () => 'Codex 显示名',
    });
    const running = task({ status: 'running', lastEventSeq: 4 });
    hub.connect('ws://127.0.0.1:47821/api/v1/ws', 'token');
    ready(FakeSocket.sockets[0]!);
    watcher.onTask(running);
    expect(taskAfterSeqs(FakeSocket.sockets[0]!)[0]).toBe(4);

    const requested = envelope(
      { type: 'approval.requested', approval: approval() },
      { seq: 5, ts: new Date().toISOString(), taskId: running.id },
    );
    FakeSocket.sockets[0]!.onmessage?.({
      data: JSON.stringify({ op: 'event', id: `task:${running.id}`, ...requested }),
    });
    expect(notify).toHaveBeenCalledOnce();

    FakeSocket.sockets[0]!.onclose?.({ code: 1001 });
    vi.advanceTimersByTime(1_000);
    ready(FakeSocket.sockets[1]!);
    expect(taskAfterSeqs(FakeSocket.sockets[1]!).at(-1)).toBe(5);
    FakeSocket.sockets[1]!.onmessage?.({
      data: JSON.stringify({ op: 'event', id: `task:${running.id}`, ...requested }),
    });
    expect(notify).toHaveBeenCalledOnce();

    FakeSocket.sockets[1]!.onclose?.({ code: WS_CLOSE_CODES.SLOW_CONSUMER });
    expect(FakeSocket.sockets).toHaveLength(2);
    vi.advanceTimersByTime(999);
    expect(FakeSocket.sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.sockets).toHaveLength(3);

    const delays = [2_000, 5_000, 10_000, 10_000];
    for (const delay of delays) {
      const current = FakeSocket.sockets.at(-1)!;
      current.onclose?.({ code: WS_CLOSE_CODES.SLOW_CONSUMER });
      const before = FakeSocket.sockets.length;
      vi.advanceTimersByTime(delay - 1);
      expect(FakeSocket.sockets).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.sockets).toHaveLength(before + 1);
    }
  });
});
