import { API_PREFIX, type ApiErrorCode, type JsonValue } from '@agent-hub/contract';
import type { z } from 'zod';
import { isRecord } from '../lib/guard';
import { readApiErrorBody } from './schemas';
import type { QueryValue } from './types';

export type ClientErrorCode = ApiErrorCode | 'NETWORK' | 'NOT_CONNECTED' | 'BAD_RESPONSE';

const CLIENT_MESSAGE: Record<'NETWORK' | 'NOT_CONNECTED' | 'BAD_RESPONSE', string> = {
  NOT_CONNECTED: '还没有连接到本地服务',
  NETWORK: '连不上本地服务',
  BAD_RESPONSE: '本地服务返回了无法识别的内容',
};

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly details: JsonValue | null;

  constructor(code: ClientErrorCode, message: string, status: number, details: JsonValue | null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** details.issues 按 path 取第一条。 */
  issues(): Map<string, string> {
    const map = new Map<string, string>();
    if (!isRecord(this.details)) return map;
    const issues = this.details.issues;
    if (!Array.isArray(issues)) return map;
    for (const issue of issues) {
      if (!isRecord(issue)) continue;
      if (typeof issue.path !== 'string' || typeof issue.message !== 'string') continue;
      if (!map.has(issue.path)) map.set(issue.path, issue.message);
    }
    return map;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (
      error.code === 'NOT_CONNECTED' ||
      error.code === 'NETWORK' ||
      error.code === 'BAD_RESPONSE'
    ) {
      return CLIENT_MESSAGE[error.code];
    }
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return '出现了未知错误';
}

export interface RequestOptions {
  query?: Record<string, QueryValue | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface HubClient {
  configure(target: { baseUrl: string; uiToken: string } | null): void;
  /**
   * 规格里的 `request<T>` 在 JSON 边界上拿不到 T。
   * 这里返回 unknown，调用方用 requestJson 做 zod 校验，避免断言。
   */
  request(method: string, path: string, options?: RequestOptions): Promise<unknown>;
}

export function createClient(): HubClient {
  let target: { baseUrl: string; uiToken: string } | null = null;

  return {
    configure(next) {
      target = next;
    },
    async request(method: string, path: string, options?: RequestOptions): Promise<unknown> {
      const current = target;
      if (!current) {
        throw new ApiError('NOT_CONNECTED', CLIENT_MESSAGE.NOT_CONNECTED, 0, null);
      }
      const url = new URL(
        `${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`,
        current.baseUrl,
      );
      appendQuery(url, options?.query);
      const headers = new Headers();
      headers.set('Authorization', `Bearer ${current.uiToken}`);
      if (options?.body !== undefined) headers.set('Content-Type', 'application/json');
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: options?.signal,
        });
      } catch (error) {
        if (isAbort(error)) throw error;
        throw new ApiError('NETWORK', CLIENT_MESSAGE.NETWORK, 0, null);
      }
      const body = await readBody(response);
      if (response.status < 200 || response.status >= 300) {
        const parsed = readApiErrorBody(body);
        if (!parsed)
          throw new ApiError('BAD_RESPONSE', CLIENT_MESSAGE.BAD_RESPONSE, response.status, null);
        throw new ApiError(parsed.code, parsed.message, response.status, parsed.details);
      }
      return body;
    },
  };
}

export const client = createClient();

export async function requestJson<S extends z.ZodType>(
  method: string,
  path: string,
  schema: S,
  options?: RequestOptions,
  http: HubClient = client,
): Promise<z.output<S>> {
  const body: unknown = await http.request(method, path, options);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('BAD_RESPONSE', CLIENT_MESSAGE.BAD_RESPONSE, 200, null);
  }
  return parsed.data;
}

function appendQuery(url: URL, query: Record<string, QueryValue | undefined> | undefined): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(
      key,
      typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value),
    );
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return parseJson(text);
  } catch {
    throw new ApiError('BAD_RESPONSE', CLIENT_MESSAGE.BAD_RESPONSE, response.status, null);
  }
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function isAbort(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}
