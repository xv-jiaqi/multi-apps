import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import {
  WS_CLOSE_CODES,
  wsClientMessageSchema,
  type Scope,
  type WsServerMessage,
} from '@agent-hub/contract';
import { WebSocketServer, type WebSocket } from 'ws';
import { AuthService } from '../auth/auth.service';
import type { Principal } from '../auth/principal';
import { parseBearer } from '../auth/tokens';
import { redact } from '../common/redact';
import { EventBus } from '../core/event-bus';
import { EventStore } from '../core/event-store';
import { TaskService } from '../core/task.service';
import { Lifecycle } from '../lifecycle';
import { mapStrings } from './bridge-output';
import { HUB_UI_ORIGINS, isAllowedHost } from './http-pipeline';
import { replayThenFollow } from './ws/replay';

const MAX_SUBS = 50;
const MAX_BRIDGE_CONNECTIONS = 8;
const SLOW_CONSUMER_BYTES = 8 * 1024 * 1024;
const PING_MS = 20_000;
const PONG_TIMEOUT_MS = 60_000;

interface ClientState {
  ws: WebSocket;
  principal: Principal | null;
  authTimer: NodeJS.Timeout | null;
  subs: Map<string, { topic: 'tasks' | 'task'; off: () => void }>;
  lastPong: number;
  /** 已交给 ws.send、写回调还没触发的字节数（含 ws 内部队列和 socket 缓冲）。 */
  pendingBytes: number;
  /** 未触发的写回调；连接关闭时统一 resolve，回放不会卡住。 */
  pendingResolvers: Set<() => void>;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** local-api.md §6：鉴权、订阅（tasks / task）、回放衔接、心跳与背压。 */
@Injectable()
export class WsHub implements OnModuleDestroy {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<ClientState>();
  private pingTimer: NodeJS.Timeout | null = null;
  private busSubs: Array<{ unsubscribe(): void }> = [];
  /** 待发送数据上限（§6.4，默认 8 MB）；测试调小（testing.md E53）。 */
  slowConsumerBytes = SLOW_CONSUMER_BYTES;

  constructor(
    private readonly auth: AuthService,
    private readonly lifecycle: Lifecycle,
    @Optional() private readonly bus?: EventBus,
    @Optional() private readonly events?: EventStore,
    @Optional() private readonly tasks?: TaskService,
  ) {}

  attach(server: HttpServer, port: number): void {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (url.pathname !== '/api/v1/ws') return rejectUpgrade(socket, 404, 'Not Found');
      if (!isAllowedHost(req.headers.host, port))
        return rejectUpgrade(socket, 421, 'Misdirected Request');
      const origin = req.headers.origin;
      if (origin !== undefined && !HUB_UI_ORIGINS.includes(origin))
        return rejectUpgrade(socket, 403, 'Forbidden');
      if (this.lifecycle.isShuttingDown()) return rejectUpgrade(socket, 503, 'Service Unavailable');
      let principal: Principal | null = null;
      if (req.headers.authorization !== undefined) {
        const bearer = parseBearer(req.headers.authorization);
        principal = bearer ? this.auth.authenticate(bearer) : null;
        if (!principal) return rejectUpgrade(socket, 401, 'Unauthorized');
        if (
          principal.kind === 'bridge' &&
          this.bridgeConnections(principal.tokenId) >= MAX_BRIDGE_CONNECTIONS
        ) {
          return rejectUpgrade(socket, 429, 'Too Many Requests');
        }
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, req, principal));
    });
    this.auth.events.on('tokenChanged', this.onTokenChanged);
    if (this.bus) {
      this.busSubs.push(
        this.bus.task$.subscribe((task) => this.broadcastTopic((id) => ({ op: 'task', id, task }))),
      );
      this.busSubs.push(
        this.bus.approval$.subscribe((approval) =>
          this.broadcastTopic((id) => ({ op: 'approval', id, approval })),
        ),
      );
    }
    this.pingTimer = setInterval(() => this.heartbeat(), PING_MS);
    this.pingTimer.unref();
  }

  private onConnection(ws: WebSocket, _req: IncomingMessage, principal: Principal | null): void {
    const state: ClientState = {
      ws,
      principal: null,
      authTimer: null,
      subs: new Map(),
      lastPong: Date.now(),
      pendingBytes: 0,
      pendingResolvers: new Set(),
    };
    this.clients.add(state);
    ws.on('pong', () => (state.lastPong = Date.now()));
    if (principal) this.markReady(state, principal);
    else {
      state.authTimer = setTimeout(() => {
        if (!state.principal) this.close(state, WS_CLOSE_CODES.UNAUTHORIZED, 'auth timeout');
      }, 5_000);
    }
    ws.on('message', (data) => this.onMessage(state, data));
    ws.on('close', () => this.cleanup(state));
  }

  private onMessage(state: ClientState, data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(String(data));
    } catch {
      return this.close(state, WS_CLOSE_CODES.BAD_MESSAGE, 'bad json');
    }
    const parsed = wsClientMessageSchema.safeParse(raw);
    if (!parsed.success) return this.close(state, WS_CLOSE_CODES.BAD_MESSAGE, 'bad message');
    const msg = parsed.data;
    if (msg.op === 'auth') {
      if (state.principal)
        return this.close(state, WS_CLOSE_CODES.BAD_MESSAGE, 'already authenticated');
      const principal = this.auth.authenticate(msg.token);
      if (!principal) return this.close(state, WS_CLOSE_CODES.UNAUTHORIZED, 'unauthorized');
      return this.markReady(state, principal);
    }
    if (!state.principal) return this.close(state, WS_CLOSE_CODES.UNAUTHORIZED, 'unauthorized');
    if (msg.op === 'ping') return this.send(state, { op: 'pong' });
    if (msg.op === 'unsubscribe') {
      state.subs.get(msg.id)?.off();
      state.subs.delete(msg.id);
      return;
    }
    // subscribe
    if (state.subs.has(msg.id) || state.subs.size >= MAX_SUBS) {
      return this.send(state, {
        op: 'error',
        id: msg.id,
        code: 'VALIDATION_FAILED',
        message: '订阅 id 重复或超过 50 个',
      });
    }
    if (msg.topic === 'tasks') {
      state.subs.set(msg.id, { topic: 'tasks', off: () => {} });
      return this.send(state, { op: 'subscribed', id: msg.id });
    }
    const row = this.tasks?.repo.task(msg.taskId);
    if (!row || !this.events || !this.bus) {
      return this.send(state, {
        op: 'error',
        id: msg.id,
        code: 'TASK_NOT_FOUND',
        message: '任务不存在',
      });
    }
    const subId = msg.id;
    const abort = new AbortController();
    let unsub: (() => void) | null = null;
    state.subs.set(subId, {
      topic: 'task',
      off: () => {
        abort.abort();
        unsub?.();
      },
    });
    this.send(state, { op: 'subscribed', id: subId });
    const events = this.events;
    const bus = this.bus;
    void replayThenFollow(
      {
        list: (taskId, after, limit) => {
          events.flush(taskId);
          return events.list(taskId, after, limit);
        },
        subscribe: (taskId, listener) => bus.subscribeTaskEvents(taskId, listener),
      },
      row.id,
      msg.afterSeq ?? 0,
      (env) => this.sendAsync(state, { op: 'event', id: subId, ...env }),
      abort.signal,
    ).then((u) => {
      if (abort.signal.aborted) u();
      else unsub = u;
    });
  }

  private markReady(state: ClientState, principal: Principal): void {
    if (state.authTimer) {
      clearTimeout(state.authTimer);
      state.authTimer = null;
    }
    if (!principal.scopes.includes('tasks:read')) {
      return this.close(state, WS_CLOSE_CODES.FORBIDDEN, 'missing tasks:read');
    }
    state.principal = principal;
    this.send(state, {
      op: 'ready',
      kind: principal.kind,
      scopes: principal.scopes as Scope[],
      admin: principal.admin,
    });
  }

  private broadcastTopic(build: (id: string) => WsServerMessage): void {
    for (const state of this.clients) {
      if (!state.principal) continue;
      for (const [id, sub] of state.subs) if (sub.topic === 'tasks') this.send(state, build(id));
    }
  }

  /**
   * 编码并交给 socket。待发送数据（未写完的字节与 bufferedAmount 取大者，再加上这条）超过
   * slowConsumerBytes 时以 4008 关闭（§6.4）。返回的 Promise 在写出或连接关闭时 resolve。
   */
  private sendAsync(state: ClientState, msg: WsServerMessage): Promise<void> {
    if (state.ws.readyState !== state.ws.OPEN) return Promise.resolve();
    const body = state.principal?.kind === 'bridge' ? mapStrings(msg, redact) : msg;
    const text = JSON.stringify(body);
    const bytes = Buffer.byteLength(text, 'utf8');
    const queued = Math.max(state.pendingBytes, state.ws.bufferedAmount);
    if (queued + bytes > this.slowConsumerBytes) {
      this.close(state, WS_CLOSE_CODES.SLOW_CONSUMER, 'slow consumer');
      return Promise.resolve();
    }
    state.pendingBytes += bytes;
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        state.pendingBytes -= bytes;
        state.pendingResolvers.delete(finish);
        resolve();
      };
      state.pendingResolvers.add(finish);
      state.ws.send(text, finish);
    });
  }

  private send(state: ClientState, msg: WsServerMessage): void {
    void this.sendAsync(state, msg);
  }

  private close(state: ClientState, code: number, reason: string): void {
    state.ws.close(code, reason);
    this.cleanup(state);
  }

  private cleanup(state: ClientState): void {
    for (const finish of [...state.pendingResolvers]) finish();
    if (state.authTimer) clearTimeout(state.authTimer);
    for (const sub of state.subs.values()) sub.off();
    state.subs.clear();
    this.clients.delete(state);
  }

  private bridgeConnections(tokenId: string): number {
    let n = 0;
    for (const s of this.clients)
      if (s.principal?.kind === 'bridge' && s.principal.tokenId === tokenId) n++;
    return n;
  }

  private heartbeat(): void {
    const now = Date.now();
    for (const state of [...this.clients]) {
      if (now - state.lastPong > PONG_TIMEOUT_MS) {
        state.ws.terminate();
        this.cleanup(state);
      } else state.ws.ping();
    }
  }

  private onTokenChanged = (info: {
    tokenId: string;
    revoked: boolean;
    lostRead?: boolean;
  }): void => {
    for (const state of [...this.clients]) {
      if (state.principal?.kind !== 'bridge' || state.principal.tokenId !== info.tokenId) continue;
      if (info.revoked) this.close(state, WS_CLOSE_CODES.UNAUTHORIZED, 'revoked');
      else if (info.lostRead) this.close(state, WS_CLOSE_CODES.FORBIDDEN, 'scope lost');
    }
  };

  onModuleDestroy(): void {
    this.auth.events.off('tokenChanged', this.onTokenChanged);
    for (const s of this.busSubs) s.unsubscribe();
    this.busSubs = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const state of [...this.clients]) this.close(state, WS_CLOSE_CODES.SHUTDOWN, 'shutdown');
    this.wss?.close();
    this.wss = null;
  }
}
