import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { WS_CLOSE_CODES, wsClientMessageSchema, type Scope } from '@agent-hub/contract';
import { WebSocketServer, type WebSocket } from 'ws';
import { AuthService } from '../auth/auth.service';
import type { Principal } from '../auth/principal';
import { parseBearer } from '../auth/tokens';

interface ClientState {
  ws: WebSocket;
  principal: Principal | null;
  authTimer: NodeJS.Timeout | null;
}

/**
 * PR1 最小 WebSocket：鉴权 + 吊销时 4401 断开。订阅/事件推送留给后续步骤。
 */
@Injectable()
export class WsHub implements OnModuleDestroy {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<ClientState>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly auth: AuthService) {}

  attach(server: HttpServer, port: number): void {
    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      const host = req.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        socket.write('HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname !== '/api/v1/ws') {
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const state: ClientState = { ws, principal: null, authTimer: null };
      this.clients.add(state);

      const bearer = parseBearer(req.headers.authorization);
      if (bearer) {
        const principal = this.auth.authenticate(bearer);
        if (!principal) {
          ws.close(WS_CLOSE_CODES.UNAUTHORIZED, 'unauthorized');
          this.clients.delete(state);
          return;
        }
        this.markReady(state, principal);
      } else {
        state.authTimer = setTimeout(() => {
          if (!state.principal) {
            ws.close(WS_CLOSE_CODES.UNAUTHORIZED, 'auth timeout');
            this.clients.delete(state);
          }
        }, 5_000);
      }

      ws.on('message', (data) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(data));
        } catch {
          ws.close(WS_CLOSE_CODES.BAD_MESSAGE, 'bad json');
          return;
        }
        const parsed = wsClientMessageSchema.safeParse(raw);
        if (!parsed.success) {
          ws.close(WS_CLOSE_CODES.BAD_MESSAGE, 'bad message');
          return;
        }
        const msg = parsed.data;
        if (msg.op === 'auth') {
          if (state.principal) return;
          const principal = this.auth.authenticate(msg.token);
          if (!principal) {
            ws.close(WS_CLOSE_CODES.UNAUTHORIZED, 'unauthorized');
            this.clients.delete(state);
            return;
          }
          this.markReady(state, principal);
          return;
        }
        if (!state.principal) {
          ws.close(WS_CLOSE_CODES.UNAUTHORIZED, 'unauthorized');
          return;
        }
        if (msg.op === 'ping') {
          ws.send(JSON.stringify({ op: 'pong' }));
          return;
        }
        // PR1：订阅尚未实现，回 VALIDATION_FAILED 但不关连接
        if (msg.op === 'subscribe' || msg.op === 'unsubscribe') {
          ws.send(
            JSON.stringify({
              op: 'error',
              id: 'id' in msg ? msg.id : undefined,
              code: 'VALIDATION_FAILED',
              message: '本版本尚未实现订阅（PR1）',
            }),
          );
        }
      });

      ws.on('close', () => {
        if (state.authTimer) clearTimeout(state.authTimer);
        this.clients.delete(state);
      });
    });

    this.unsubscribe = () => undefined;
    this.auth.events.on('tokenChanged', this.onTokenChanged);
  }

  private markReady(state: ClientState, principal: Principal): void {
    if (state.authTimer) {
      clearTimeout(state.authTimer);
      state.authTimer = null;
    }
    state.principal = principal;
    state.ws.send(
      JSON.stringify({
        op: 'ready',
        kind: principal.kind,
        scopes: principal.scopes as Scope[],
        admin: principal.admin,
      }),
    );
  }

  private onTokenChanged = (info: {
    tokenId: string;
    revoked: boolean;
    lostRead?: boolean;
  }): void => {
    for (const state of [...this.clients]) {
      if (state.principal?.kind !== 'bridge' || state.principal.tokenId !== info.tokenId) continue;
      if (info.revoked) {
        state.ws.close(WS_CLOSE_CODES.UNAUTHORIZED, 'revoked');
        this.clients.delete(state);
      } else if (info.lostRead) {
        state.ws.close(WS_CLOSE_CODES.FORBIDDEN, 'scope lost');
        this.clients.delete(state);
      }
    }
  };

  onModuleDestroy(): void {
    this.auth.events.off('tokenChanged', this.onTokenChanged);
    for (const state of this.clients) {
      state.ws.close(WS_CLOSE_CODES.SHUTDOWN, 'shutdown');
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }
}
