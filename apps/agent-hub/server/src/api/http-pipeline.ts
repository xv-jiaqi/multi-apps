// server/src/api/http-pipeline.ts
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { API_PREFIX } from '@agent-hub/contract';
import { setPrincipal, type Principal } from '../auth/principal';
import { parseBearer } from '../auth/tokens';
import { ApiError } from './api-error';

/**
 * 允许跨域访问的来源只有 Hub UI：生产包是 tauri://localhost；`tauri dev` 与浏览器开发模式是
 * Vite 开发服务器。Rust 壳不区分开发与生产，所以开发来源始终放行（仍然要 token）。
 */
export const HUB_UI_ORIGINS: readonly string[] = [
  'tauri://localhost',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function sendApiError(res: Response, error: ApiError): void {
  res.status(error.status).json(error.toBody());
}

const requestIds = new WeakMap<IncomingMessage, string>();
export const requestIdOf = (req: IncomingMessage): string => requestIds.get(req) ?? 'req_unknown';

export interface HttpPipelineDeps {
  port: number;
  isShuttingDown(): boolean;
  /** UI token 或未吊销的桥接 token → 主体；否则 null。 */
  authenticate(token: string): Principal | null;
  /** 桥接 token 的令牌桶；返回 false 表示超限。 */
  takeRateToken(tokenId: string): boolean;
}

/** 按顺序 app.use(...)；都在 Nest 路由之前执行。 */
export function httpPipeline(deps: HttpPipelineDeps): RequestHandler[] {
  const json = express.json({ limit: '1mb' });

  const requestId: RequestHandler = (req, res, next) => {
    const id = `req_${randomBytes(6).toString('hex')}`;
    requestIds.set(req, id);
    res.setHeader('X-Request-Id', id);
    next();
  };

  const network: RequestHandler = (req, res, next) => {
    if (!isAllowedHost(req.headers.host, deps.port)) {
      return sendApiError(
        res,
        new ApiError('HOST_FORBIDDEN', '只接受 127.0.0.1 或 localhost 访问'),
      );
    }
    const origin = req.headers.origin;
    if (origin === undefined) return next();
    if (!HUB_UI_ORIGINS.includes(origin)) {
      return sendApiError(res, new ApiError('ORIGIN_FORBIDDEN', '不允许该来源访问'));
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, X-Agent-Hub-Truncated');
    if (req.method !== 'OPTIONS') return next();
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
  };

  const shutdownGate: RequestHandler = (_req, res, next) => {
    if (deps.isShuttingDown()) {
      return sendApiError(res, new ApiError('SHUTTING_DOWN', 'Agent Hub 正在退出'));
    }
    next();
  };

  const authenticate: RequestHandler = (req, res, next) => {
    if (req.method === 'GET' && req.path === `${API_PREFIX}/health`) return next();
    const token = parseBearer(req.headers.authorization);
    const principal = token ? deps.authenticate(token) : null;
    if (!principal)
      return sendApiError(res, new ApiError('UNAUTHORIZED', '缺少 token，或 token 无效、已吊销'));
    if (principal.kind === 'bridge' && !deps.takeRateToken(principal.tokenId)) {
      res.setHeader('Retry-After', '1');
      return sendApiError(res, new ApiError('RATE_LIMITED', '请求过于频繁，请稍后重试'));
    }
    setPrincipal(req, principal);
    next();
  };

  const jsonBody: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    json(req, res, (err?: unknown) => {
      if (!err) return next();
      const type = (err as { type?: unknown }).type;
      if (type === 'entity.too.large') {
        return sendApiError(res, new ApiError('PAYLOAD_TOO_LARGE', '请求体超过 1 MB'));
      }
      sendApiError(res, new ApiError('VALIDATION_FAILED', '请求体不是合法的 JSON'));
    });
  };

  return [requestId, network, shutdownGate, authenticate, jsonBody];
}
