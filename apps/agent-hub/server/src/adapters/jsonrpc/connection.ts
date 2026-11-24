import type { Readable, Writable } from 'node:stream';

export type JsonRpcId = number | string;

/** 对端回复的 error，或本端请求处理器抛出后要回给对端的 error。 */
export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export class JsonRpcTimeoutError extends Error {
  constructor(
    readonly method: string,
    readonly timeoutMs: number,
  ) {
    super(`${method} 在 ${timeoutMs} ms 内没有响应`);
  }
}

export class JsonRpcClosedError extends Error {
  constructor(readonly method: string) {
    super(`连接已关闭，${method} 没有响应`);
  }
}

export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INTERNAL_ERROR = -32603;

/** 请求处理器返回它表示不回复（对端已经撤回了这个请求，例如 Codex 的 serverRequest/resolved）。 */
export const NO_RESPONSE: unique symbol = Symbol('NO_RESPONSE');

export type RequestHandler = (method: string, params: unknown, id: JsonRpcId) => unknown;
export type NotificationHandler = (method: string, params: unknown) => void;

export interface JsonRpcConnectionOptions {
  /** 写出的帧是否带 "jsonrpc": "2.0"：ACP 要带，Codex app-server 不带。 */
  includeJsonrpcField: boolean;
  /** request() 的默认超时；null 表示不超时。默认 60 秒。 */
  defaultTimeoutMs?: number | null;
  /** 单行上限（字符数），超过则关闭连接。默认 32 MiB。 */
  maxLineLength?: number;
  /** 每一行原始帧（不含换行符），写 transcript 用。 */
  onRaw?(direction: 'in' | 'out', line: string): void;
  /** 不是 JSON-RPC 消息的行（Agent 往 stdout 打了日志）；只记日志，不中断连接。 */
  onInvalidLine?(line: string): void;
}

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
}

type Incoming = {
  id?: JsonRpcId | null;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
};

/** 换行分隔的 JSON-RPC 2.0，一行一个消息；不支持批量。 */
export class JsonRpcConnection {
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private isClosed = false;
  private nextId = 0;
  private buffer = '';
  private readonly pending = new Map<JsonRpcId, Pending>();
  private requestHandler: RequestHandler | null = null;
  private notificationHandler: NotificationHandler | null = null;
  private readonly defaultTimeoutMs: number | null;
  private readonly maxLineLength: number;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly options: JsonRpcConnectionOptions,
  ) {
    this.defaultTimeoutMs =
      options.defaultTimeoutMs === undefined ? 60_000 : options.defaultTimeoutMs;
    this.maxLineLength = options.maxLineLength ?? 32 * 1024 * 1024;
    this.closed = new Promise((resolve) => (this.resolveClosed = resolve));
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => this.onData(chunk));
    input.on('end', () => this.close());
    input.on('close', () => this.close());
    input.on('error', () => this.close());
    output.on('error', () => this.close());
    output.on('close', () => this.close());
  }

  get isOpen(): boolean {
    return !this.isClosed;
  }

  /** 只能设置一次；没有处理器时对端的请求一律回 -32601。 */
  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  request<T = unknown>(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number | null; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (this.isClosed) return Promise.reject(new JsonRpcClosedError(method));
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs === undefined ? this.defaultTimeoutMs : options.timeoutMs;
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const onAbort = () => {
        this.pending.get(id)?.cleanup();
        reject(
          options.signal!.reason instanceof Error ? options.signal!.reason : new Error('aborted'),
        );
      };
      const entry: Pending = {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        cleanup: () => {
          this.pending.delete(id);
          if (timer) clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
        },
      };
      this.pending.set(id, entry);
      if (timeoutMs !== null) {
        timer = setTimeout(() => {
          entry.cleanup();
          reject(new JsonRpcTimeoutError(method, timeoutMs));
        }, timeoutMs);
      }
      if (options.signal) {
        if (options.signal.aborted) return onAbort();
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
      this.write(params === undefined ? { id, method } : { id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.isClosed) return;
    this.write(params === undefined ? { method } : { method, params });
  }

  /** 幂等。所有未完成的请求以 JsonRpcClosedError 失败；之后的 request 立即失败、notify 被忽略。 */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const entry of [...this.pending.values()]) {
      entry.cleanup();
      entry.reject(new JsonRpcClosedError(entry.method));
    }
    this.resolveClosed();
  }

  private write(message: Record<string, unknown>): void {
    const frame = this.options.includeJsonrpcField ? { jsonrpc: '2.0', ...message } : message;
    const line = JSON.stringify(frame);
    this.options.onRaw?.('out', line);
    this.output.write(`${line}\n`);
  }

  private onData(chunk: string): void {
    if (this.isClosed) return;
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim() !== '') this.onLine(line);
      if (this.isClosed) return;
    }
    if (this.buffer.length > this.maxLineLength) {
      this.options.onInvalidLine?.(`${this.buffer.slice(0, 200)}…（单行超过上限，连接关闭）`);
      this.close();
    }
  }

  private onLine(line: string): void {
    this.options.onRaw?.('in', line);
    let message: Incoming;
    try {
      message = JSON.parse(line) as Incoming;
    } catch {
      this.options.onInvalidLine?.(line);
      return;
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      this.options.onInvalidLine?.(line);
      return;
    }
    const hasId = message.id !== undefined && message.id !== null;
    if (typeof message.method === 'string') {
      if (hasId) void this.handleRequest(message.id!, message.method, message.params);
      else this.notificationHandler?.(message.method, message.params);
      return;
    }
    if (hasId && ('result' in message || 'error' in message)) {
      const entry = this.pending.get(message.id!);
      if (!entry) return;
      entry.cleanup();
      if (message.error) {
        const { code, message: text, data } = message.error;
        entry.reject(
          new JsonRpcError(
            typeof code === 'number' ? code : JSONRPC_INTERNAL_ERROR,
            typeof text === 'string' ? text : 'Unknown error',
            data,
          ),
        );
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    this.options.onInvalidLine?.(line);
  }

  private async handleRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    let response: Record<string, unknown>;
    try {
      if (!this.requestHandler)
        throw new JsonRpcError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
      const result = await this.requestHandler(method, params, id);
      if (result === NO_RESPONSE) return;
      response = { id, result: result ?? null };
    } catch (err) {
      const error =
        err instanceof JsonRpcError
          ? {
              code: err.code,
              message: err.message,
              ...(err.data === undefined ? {} : { data: err.data }),
            }
          : { code: JSONRPC_INTERNAL_ERROR, message: 'Internal error' };
      response = { id, error };
    }
    if (!this.isClosed) this.write(response);
  }
}
