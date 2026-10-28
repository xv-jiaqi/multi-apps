import { WS_CLOSE_CODES } from '@agent-hub/contract';
import { createSocket, type SocketLike } from '../src/api/socket';

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

describe('WebSocket', () => {
  beforeEach(() => {
    FakeSocket.sockets = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('首条是 auth，ready 后重发订阅；关闭码 4401 停止', () => {
    const hub = createSocket((url) => new FakeSocket(url));
    const onResync = vi.fn();
    hub.subscribeTasks({ onTask: () => undefined, onApproval: () => undefined, onResync });
    hub.connect('ws://127.0.0.1:47821/api/v1/ws', 'token-a');
    const first = FakeSocket.sockets[0];
    expect(first?.url).toBe('ws://127.0.0.1:47821/api/v1/ws');
    ready(first!);
    expect(JSON.parse(first!.sent[0] ?? '{}')).toMatchObject({ op: 'auth', token: 'token-a' });
    expect(JSON.parse(first!.sent[1] ?? '{}')).toMatchObject({ op: 'subscribe', topic: 'tasks' });
    expect(onResync).not.toHaveBeenCalled();
    first!.onmessage?.({ data: JSON.stringify({ op: 'subscribed', id: 'tasks' }) });
    expect(onResync).toHaveBeenCalledOnce();
    first!.onclose?.({ code: WS_CLOSE_CODES.UNAUTHORIZED });
    expect(hub.getStatus()).toBe('stopped');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.sockets).toHaveLength(1);
    hub.connect('ws://127.0.0.1:47821/api/v1/ws', 'token-b');
    expect(FakeSocket.sockets).toHaveLength(2);
  });

  it('普通断开和 4008 都按 1、2、5、10 秒重连，之后保持 10 秒，4400 和 4403 停止', () => {
    const hub = createSocket((url) => new FakeSocket(url));
    hub.connect('ws://127.0.0.1:47821/api/v1/ws', 'token');
    ready(FakeSocket.sockets[0]!);
    FakeSocket.sockets[0]!.onclose?.({ code: 1006 });
    expect(hub.getStatus()).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(FakeSocket.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.sockets).toHaveLength(2);
    FakeSocket.sockets[1]!.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(2000);
    expect(FakeSocket.sockets).toHaveLength(3);
    FakeSocket.sockets[2]!.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.sockets).toHaveLength(4);
    FakeSocket.sockets[3]!.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.sockets).toHaveLength(5);
    FakeSocket.sockets[4]!.onclose?.({ code: WS_CLOSE_CODES.SLOW_CONSUMER });
    expect(FakeSocket.sockets).toHaveLength(5);
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.sockets).toHaveLength(6);
    FakeSocket.sockets[5]!.onclose?.({ code: WS_CLOSE_CODES.BAD_MESSAGE });
    expect(hub.getStatus()).toBe('stopped');
    const stopped = createSocket((url) => new FakeSocket(url));
    stopped.connect('ws://127.0.0.1:47821/api/v1/ws', 'token');
    const last = FakeSocket.sockets.at(-1)!;
    ready(last);
    last.onclose?.({ code: WS_CLOSE_CODES.FORBIDDEN });
    expect(stopped.getStatus()).toBe('stopped');
  });
});
