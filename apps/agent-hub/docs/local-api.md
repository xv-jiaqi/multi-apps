# 本地 API 契约

> 上级文档：[../README.md](../README.md)。Hub UI 和本地郎用**同一套** REST + WebSocket 接口 `/api/v1`（D23），背后是同一组服务、同一套鉴权。本文的 TypeScript 代码（contract 类型、鉴权与中间件、幂等、截断、WS 回放、本地郎示例）都已在 Node 22 + TypeScript 6 + NestJS 11 + Express 5 下编译并跑过运行测试，**原样复制**即可。

## 1. 总览

| 项目   | 约定                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 地址   | `http://127.0.0.1:<port>/api/v1`，WebSocket `ws://127.0.0.1:<port>/api/v1/ws`；端口默认 47821（D10）。                        |
| 监听   | 只绑定 `127.0.0.1`（`app.listen(port, '127.0.0.1')`）。                                                                       |
| 调用方 | Hub UI（UI token，可调全部接口）；本地郎等本机进程（桥接 token，按 scope）。Bot 页面里的脚本调不了（§2.1）。                  |
| 版本   | `/api/v1` 只做向后兼容的增量修改（加字段、加接口、加事件类型、加错误码）；客户端必须忽略不认识的字段和事件类型。              |
| 契约   | 请求体、查询参数、DTO、事件、错误码都在 `@agent-hub/contract`（§4，事件见 [adapter-interface.md](adapter-interface.md) §3）。 |

### 1.1 侧车里的文件

| 文件                              | 内容                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `server/src/auth/tokens.ts`       | token 生成、哈希、Bearer 解析、常量时间比较（§2.2）                                               |
| `server/src/auth/principal.ts`    | 调用主体类型、按请求存取主体、任务归属检查（§2.3）                                                |
| `server/src/auth/auth.service.ts` | `authenticate(token)`；默认桥接 token 的启动检查与轮换；token 变化通知 WS（§2.2、§5.10）          |
| `server/src/auth/rate-limit.ts`   | 桥接 token 的令牌桶（§2.1）                                                                       |
| `server/src/api/http-pipeline.ts` | Nest 路由之前的 Express 中间件：请求 id、Host / Origin / CORS、停机闸门、鉴权、JSON 解析          |
| `server/src/api/access.ts`        | `@Public()`、`@Scopes()` 与全局守卫 `AccessGuard`（§2.3）                                         |
| `server/src/api/api-error.ts`     | `ApiError`、`parseInput()`（§3.2）                                                                |
| `server/src/api/error.filter.ts`  | 全局异常过滤器（§3.2）                                                                            |
| `server/src/api/idempotency.ts`   | 请求哈希（§3.3）                                                                                  |
| `server/src/api/bridge-output.ts` | 桥接方响应脱敏拦截器、补丁截断（§3.4）                                                            |
| `server/src/api/*.controller.ts`  | `health`、`agents`、`repos`、`tasks`、`approvals`、`settings`、`tokens`、`admin`（§5）            |
| `server/src/api/ws.gateway.ts`    | WebSocket（§6），用 `ws` 的 `noServer` 模式挂在 Nest 的 HTTP server 上，不用 `@nestjs/websockets` |
| `server/src/api/ws/replay.ts`     | 订阅时的回放与衔接（§6.3）                                                                        |

`main.ts` 里的装配顺序（Nest 用 Express 平台，`@nestjs/platform-express`）：

```ts
z.config(z.locales.zhCN()); // zod 默认错误信息改成中文；web/src/main.tsx 也调一次
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  bodyParser: false,
  logger,
});
for (const handler of httpPipeline(deps)) app.use(handler); // 必须在 listen 之前，才会排在路由前面
app.setGlobalPrefix('api/v1');
app.useGlobalFilters(new ApiErrorFilter(hubLogger));
await app.listen(port, '127.0.0.1');
app.get(WsGateway).attach(app.getHttpServer());
```

`AccessGuard` 和 `BridgeRedactInterceptor` 在 `AppModule` 里用 `APP_GUARD`、`APP_INTERCEPTOR` 注册为全局。控制器只做三件事：`parseInput(schema, body | query)`、调用核心服务、返回 DTO。

## 2. 鉴权与访问控制

### 2.1 网络层

每个 HTTP 请求和 WebSocket 握手都依次检查：

| 检查     | 规则                                                                                                                                             | 失败                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `Host`   | 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`（防 DNS rebinding）。                                                                            | `421 HOST_FORBIDDEN`                      |
| `Origin` | 没有 `Origin` 的请求（curl、Node 客户端）放行；有 `Origin` 时必须是 `tauri://localhost`、`http://localhost:5174`、`http://127.0.0.1:5174` 之一。 | `403 ORIGIN_FORBIDDEN`                    |
| CORS     | 只对上面三个来源回 `Access-Control-Allow-Origin: <origin>`，不用通配、不带 Cookie；`OPTIONS` 预检在这一层直接回 `204`。                          | —                                         |
| 停机     | 侧车停机期间（[architecture.md](architecture.md) §10.3）拒绝新请求。                                                                             | `503 SHUTTING_DOWN`                       |
| 速率     | **只限制桥接 token**：每个 token 令牌桶，平均 50 次/秒、突发 100 次；同时挂起的 `wait` 最多 16 个；WebSocket 连接最多 8 个。UI token 不限。      | `429 RATE_LIMITED`（带 `Retry-After: 1`） |

- 允许的来源只有 Hub UI：生产包里 Hub UI 的页面是 `tauri://localhost`；`tauri dev` 和浏览器开发模式下是 Vite 开发服务器 `http://localhost:5174`。Rust 壳（D2）不区分开发与生产，所以开发来源**始终**放行；放行的只是 CORS，请求仍然要 token。
- Bot 页面（本地郎对话页）的来源永远不在名单里：它发出的带 `Authorization` 头的请求过不了预检，简单请求也直接 403（D47）。

### 2.2 token

| 主体   | 格式                                          | 来源与存放                                                                                                                                                           | 权限                           |
| ------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Hub UI | `ahu_` + 32 字节随机数的 base64url（47 字符） | 侧车每次启动生成，只在内存里；经 ready 行交给 Rust 壳，`sidecar_start` 返回给 Hub UI（D9）。浏览器开发模式下 stderr 打印 `http://localhost:5174/#uiToken=…`。        | 全部 scope + 管理接口          |
| 桥接方 | `ahb_` + 32 字节随机数的 base64url（47 字符） | 设置页创建，可以有多个、可以吊销；库里只存 SHA-256 和前 12 个字符（[data-model.md](data-model.md) §3.3）。首次启动自动创建默认 token，明文写 `bridge-token`（D44）。 | 按 scope（§2.3），没有管理权限 |

- 请求头 `Authorization: Bearer <token>`。WebSocket 也可以握手后发首条消息鉴权（§6.1）。
- 校验（`AuthService.authenticate`）：`ahu_` 开头 → 与内存里的 UI token 常量时间比较；`ahb_` 开头 → SHA-256 后查 `findActiveTokenByHash`（`revoked_at IS NULL`）；其他一律 `401 UNAUTHORIZED`。桥接 token 校验成功后更新 `last_used_at`，同一 token 每 60 秒最多写一次。
- 吊销或改 scope 立即生效：`AuthService` 发出 `tokenChanged(tokenId)`，WebSocket 网关断开该 token 已吊销的连接（`4401`），失去 `tasks:read` 的连接（`4403`）。

**默认桥接 token**（启动第 8 步，[architecture.md](architecture.md) §10.2）由 `AuthService.ensureDefaultToken()` 维护，规则只有四条：

| 库里的状态                                    | `bridge-token` 文件      | 动作                                                                        |
| --------------------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| 从来没有过默认 token（`is_default = 1` 的行） | 任意                     | 新建默认 token“本地郎（默认）”，scope `tasks:read`、`tasks:write`，写文件。 |
| 有未吊销的默认 token                          | 存在且内容的哈希与它一致 | 什么都不做。                                                                |
| 有未吊销的默认 token                          | 不存在，或哈希不一致     | **轮换**（§5.10）：明文已经找不回来，只能换新的。                           |
| 只有已吊销的默认 token                        | 任意                     | 什么都不做；文件存在就删掉。用户主动吊销了，不自动恢复。                    |

文件内容是 token 明文加一个换行，权限 `0600`，原子写入（先写 `bridge-token.tmp` 再 `rename`）。

```ts
// server/src/auth/tokens.ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const UI_TOKEN_PREFIX = 'ahu_';
export const BRIDGE_TOKEN_PREFIX = 'ahb_';

/** 前缀 + 32 字节随机数的 base64url，共 47 个字符。 */
export function generateToken(prefix: typeof UI_TOKEN_PREFIX | typeof BRIDGE_TOKEN_PREFIX): string {
  return prefix + randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 界面上用来辨认 token 的前 12 个字符，例如 "ahb_3kF9xQ2a"。 */
export function tokenDisplayPrefix(token: string): string {
  return token.slice(0, 12);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function parseBearer(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{8,200})$/.exec(header ?? '');
  return match ? match[1]! : null;
}
```

### 2.3 scope、管理接口与任务归属

| scope              | 允许                                                                                                       | 默认 token      |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | --------------- |
| `tasks:read`       | 读 Agent、仓库、任务、轮、事件、结果、diff、审批列表；WebSocket 订阅。**能读所有任务**（包括界面创建的）。 | 有              |
| `tasks:write`      | 创建任务；对**自己创建的**任务追问、取消、归档、取消归档。                                                 | 有              |
| `approvals:decide` | 对**自己创建的**任务的审批做决定。                                                                         | **没有**（D44） |

- **管理接口**只认 UI token：设置、token 管理、仓库体检与禁用推送、删除任务、应用改动、网页任务的“完成本轮”与链接、诊断包、审计、Agent 刷新。桥接 token 调用返回 `403 ADMIN_ONLY`。
- 缺 scope → `403 FORBIDDEN_SCOPE`（`details.required` 列出缺的 scope）。
- **归属**：任务的 `sourceTokenId` 等于调用方 token id 才算“自己的”。界面创建的任务 `sourceTokenId` 为 `null`，桥接方只能读不能改。不是自己的 → `403 TASK_NOT_OWNED`。
- 实现上**默认即管理接口**：路由不加任何标注就只允许 UI token；`@Public()` 只用在 `GET /health`；`@Scopes(...)` 标注桥接方可调的接口（不带参数 = 任何已鉴权主体，只有 `GET /me` 这样用）。各接口的标注见 §5.1 的“权限”列，[testing.md](testing.md) 有一个用例按该表逐条核对。

```ts
// server/src/auth/principal.ts
import type { IncomingMessage } from 'node:http';
import { SCOPES, type Scope, type TaskDto } from '@agent-hub/contract';
import { ApiError } from '../api/api-error';

export type Principal =
  | { kind: 'ui'; tokenId: null; scopes: readonly Scope[]; admin: true }
  | { kind: 'bridge'; tokenId: string; scopes: readonly Scope[]; admin: false };

export const UI_PRINCIPAL: Principal = { kind: 'ui', tokenId: null, scopes: SCOPES, admin: true };

const principals = new WeakMap<IncomingMessage, Principal>();

export function setPrincipal(req: IncomingMessage, principal: Principal): void {
  principals.set(req, principal);
}

export function findPrincipal(req: IncomingMessage): Principal | undefined {
  return principals.get(req);
}

export function getPrincipal(req: IncomingMessage): Principal {
  const principal = principals.get(req);
  if (!principal) throw new Error('请求没有经过鉴权中间件');
  return principal;
}

/** 桥接 token 只能管理自己创建的任务；UI token 不受限。 */
export function assertOwns(principal: Principal, task: Pick<TaskDto, 'sourceTokenId'>): void {
  if (principal.kind === 'bridge' && task.sourceTokenId !== principal.tokenId) {
    throw new ApiError('TASK_NOT_OWNED', '只能操作本 token 创建的任务');
  }
}
```

```ts
// server/src/api/access.ts
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Scope } from '@agent-hub/contract';
import type { Request } from 'express';
import { getPrincipal } from '../auth/principal';
import { ApiError } from './api-error';

const ACCESS_KEY = 'agent-hub:access';
type Access = { kind: 'public' } | { kind: 'scopes'; scopes: Scope[] };

/** 免鉴权。全项目只有 GET /health 用。 */
export const Public = () => SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies Access);

/** 需要这些 scope；不传参数 = 任何已鉴权的主体。UI token 拥有全部 scope。 */
export const Scopes = (...scopes: Scope[]) =>
  SetMetadata(ACCESS_KEY, { kind: 'scopes', scopes } satisfies Access);

/** 全局守卫（APP_GUARD）。没有 @Public / @Scopes 标注的路由只允许 UI token：默认就是管理接口。 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (access?.kind === 'public') return true;
    const principal = getPrincipal(context.switchToHttp().getRequest<Request>());
    if (!access) {
      if (!principal.admin) throw new ApiError('ADMIN_ONLY', '只有 Hub 界面可以调用这个接口');
      return true;
    }
    const missing = access.scopes.filter((scope) => !principal.scopes.includes(scope));
    if (missing.length > 0) {
      throw new ApiError('FORBIDDEN_SCOPE', `token 缺少 scope：${missing.join('、')}`, {
        required: missing,
      });
    }
    return true;
  }
}
```

```ts
// server/src/auth/rate-limit.ts
/** 每个桥接 token 一个令牌桶：平均每秒 ratePerSec 个请求，允许突发 burst 个。 */
export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly ratePerSec = 50,
    private readonly burst = 100,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, at: t };
    bucket.tokens = Math.min(
      this.burst,
      bucket.tokens + ((t - bucket.at) / 1000) * this.ratePerSec,
    );
    bucket.at = t;
    this.buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
```

HTTP 中间件链（`app.use` 依次挂上，全部在 Nest 路由之前）：

```ts
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
```

## 3. 通用约定

### 3.1 格式

- 请求、响应都是 UTF-8 JSON（`format=patch` 的 diff 除外）。有请求体的接口要求 `Content-Type: application/json`；没有请求体的 `POST` 可以不带体或带 `{}`。
- 请求体上限 **1 MB**（`413 PAYLOAD_TOO_LARGE`），提示词另有 20 万字符上限（schema 校验）。
- 请求体用 `z.strictObject`：多出不认识的字段 → `400 VALIDATION_FAILED`。查询参数里不认识的键忽略。
- 时间是 ISO 8601 UTC 带毫秒（`2026-10-28T03:15:00.000Z`）。id 是 UUID；路径里的任务 `:id` **既接受完整 id 也接受 8 位短号**，其他资源只接受完整 id。
- 状态码：`200` 成功；`201` 新建了任务、轮或 token；`204` 删除成功（没有响应体）；错误见 §7。
- 集合：任务列表用游标分页（`ListTasksResponse`），事件用 `afterSeq`，审计用 `before`；其余集合不分页，统一包成 `{ "items": [...] }`。
- 每个响应带 `X-Request-Id: req_<12 位十六进制>`，侧车日志里同一请求的记录带同一个 id。

### 3.2 错误

所有错误响应都是 `ApiErrorBody`：

```json
{
  "error": {
    "code": "TASK_BUSY",
    "message": "任务正在运行，不能追问",
    "details": { "status": "running" }
  }
}
```

- `message` 是给人看的中文；程序只看 `code`。完整列表见 §7。
- `VALIDATION_FAILED` / `CONFIG_INVALID` 的 `details` 是 `{ "issues": [{ "path": "prompt", "message": "提示词不能为空" }] }`，最多 20 条；`path` 是 zod 路径用 `.` 连接，根对象为空串。
- `INTERNAL` 的 `details` 是 `{ "requestId": "req_…" }`，详细错误只进日志。
- 业务代码只抛 `ApiError`；其他异常由过滤器转成 `INTERNAL`；不存在的路由是 `404 NOT_FOUND`。

```ts
// server/src/api/api-error.ts
import {
  API_ERROR_STATUS,
  type ApiErrorBody,
  type ApiErrorCode,
  type JsonValue,
  type ValidationIssue,
} from '@agent-hub/contract';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: JsonValue,
  ) {
    super(message);
  }

  get status(): number {
    return API_ERROR_STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.message };
    if (this.details !== undefined) error.details = this.details;
    return { error };
  }
}

export function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** 校验失败抛 VALIDATION_FAILED（设置页用 CONFIG_INVALID），details = { issues }。 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  code: 'VALIDATION_FAILED' | 'CONFIG_INVALID' = 'VALIDATION_FAILED',
): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = code === 'CONFIG_INVALID' ? '配置不合法' : '请求参数不合法';
    throw new ApiError(code, message, { issues: toIssues(result.error) });
  }
  return result.data;
}
```

```ts
// server/src/api/error.filter.ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from './api-error';
import { requestIdOf, sendApiError } from './http-pipeline';

export interface ErrorLogger {
  error(msg: string, meta: Record<string, unknown>): void;
}

/** 全局过滤器：所有错误响应都是 ApiErrorBody。 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: ErrorLogger) {}

  catch(err: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) return;
    if (err instanceof ApiError) return sendApiError(res, err);
    if (err instanceof HttpException && err.getStatus() === 404) {
      return sendApiError(res, new ApiError('NOT_FOUND', '接口不存在'));
    }
    const requestId = requestIdOf(req);
    this.logger.error('未处理的错误', { requestId, method: req.method, path: req.path, err });
    sendApiError(res, new ApiError('INTERNAL', '内部错误，详情见侧车日志', { requestId }));
  }
}
```

`ErrorLogger` 由 `common/logger.ts` 的日志类实现（[architecture.md](architecture.md) §11），`err` 写日志前经过 `redact()`。

### 3.3 幂等

`POST /tasks`（创建）和 `POST /tasks/:id/turns`（追问）支持请求头 `Idempotency-Key`。**桥接方应当总是带上**，推荐用“对话 id:消息 id”，这样网络重试、本地郎重启后重发都不会重复派发。

| 规则     | 内容                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 适用     | 只对桥接 token 生效（键按 token 隔离，存在 `idempotency_keys` 表）；UI token 带了也忽略。                                                                                              |
| 格式     | `IDEMPOTENCY_KEY_PATTERN`：1–200 个 `A–Z a–z 0–9 . _ : -`。不合法 → `400 VALIDATION_FAILED`。                                                                                          |
| 请求哈希 | `requestHash(方法, routeKey, 原始请求体)`：`routeKey` 是 `/tasks` 或 `/tasks/<完整任务 id>/turns`（短号先解析成完整 id），请求体用 zod 解析**之前**的原始 JSON，键排序后计算 SHA-256。 |
| 命中     | 同一 token、同一键、哈希相同 → 不做任何事，返回 `200` 和**当前状态**的 `{ task, turn, replayed: true }`；哈希不同 → `409 IDEMPOTENCY_CONFLICT`。                                       |
| 有效期   | 24 小时：查找时忽略并删除超过 24 小时的键；保留策略每 6 小时清理一次（[data-model.md](data-model.md) §6）。                                                                            |
| 失败     | 只记录成功的请求。校验失败、`QUEUE_FULL` 等错误不占用这个键，可以用同一个键重试。                                                                                                      |
| 检查时机 | 解析请求体、解析任务 id、检查归属之后，**其余业务检查之前**。这样第一次追问成功（任务已是 `queued`）后重试同一请求会得到回放，而不是 `TASK_BUSY`。                                     |
| 并发     | 写入在同一个同步事务里：事务开头再查一次键（期间可能有同键的请求已经写入），查到就按“命中”处理；查不到就插入任务 / 轮和键。                                                            |

```ts
// server/src/api/idempotency.ts
import { createHash } from 'node:crypto';

/** 键排序后的 JSON，用来判断“同样的请求体”。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const fields = Object.keys(obj)
      .sort()
      .filter((key) => obj[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** routeKey：`/tasks` 或 `/tasks/<完整任务 id>/turns`（短号先解析成完整 id）。 */
export function requestHash(method: string, routeKey: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()} ${routeKey}\n${canonicalJson(body ?? {})}`, 'utf8')
    .digest('hex');
}
```

### 3.4 返回给桥接方的内容：脱敏与截断

- **脱敏**：`BridgeRedactInterceptor`（全局）把返回给桥接 token 的响应里每一个字符串值过一遍 `redact()`（[security.md](security.md) §6），包括提示词、消息、工具输出、命令、审批详情、错误信息、diff 补丁；WebSocket 消息同样处理（§6）。Hub UI 拿到的是原文。
- **diff 截断**：桥接方读取补丁时先脱敏，再按文件边界截断到 `security.maxBridgeDiffBytes`（默认 512 KB，UTF-8 字节数），被截断时 JSON 里 `truncated: true`、`format=patch` 时响应头 `X-Agent-Hub-Truncated: true`（D46）。
- **审计**：桥接 token 每次读 diff 记一条 `bridge.diff_read`（[data-model.md](data-model.md) §7）。
- 工具输出在落库时已经按单个工具 1 MB 截断（[architecture.md](architecture.md) §6），事件接口不再另外截断。

```ts
// server/src/api/bridge-output.ts
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { findPrincipal } from '../auth/principal';
import { redact } from '../common/redact';

/** 对 JSON 值里的每个字符串（不含键名）应用 fn。 */
export function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = mapStrings(v, fn);
    return out;
  }
  return value;
}

/** 全局拦截器：响应给桥接 token 的内容统一脱敏（redact 是幂等的，重复执行无害）。 */
@Injectable()
export class BridgeRedactInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const principal = findPrincipal(context.switchToHttp().getRequest<Request>());
    if (principal?.kind !== 'bridge') return next.handle();
    return next.handle().pipe(map((body: unknown) => mapStrings(body, redact)));
  }
}

/**
 * 按文件边界截断补丁，使 UTF-8 字节数不超过 maxBytes。
 * 第一个文件就超限时返回空串；没有超限时原样返回。
 */
export function truncatePatch(
  patch: string,
  maxBytes: number,
): { patch: string; truncated: boolean } {
  if (Buffer.byteLength(patch, 'utf8') <= maxBytes) return { patch, truncated: false };
  const starts: number[] = [];
  const header = /^diff --git /gm;
  for (let m = header.exec(patch); m; m = header.exec(patch)) starts.push(m.index);
  if (starts[0] !== 0) starts.unshift(0);
  starts.push(patch.length);
  let used = 0;
  let end = 0;
  for (let i = 0; i + 1 < starts.length; i++) {
    const size = Buffer.byteLength(patch.slice(starts[i], starts[i + 1]), 'utf8');
    if (used + size > maxBytes) break;
    used += size;
    end = starts[i + 1]!;
  }
  return { patch: patch.slice(0, end), truncated: true };
}
```

## 4. 契约类型

`@agent-hub/contract` 的 `dto.ts` 与 `api.ts`。其余文件的全文：`domain.ts`、`events.ts`、`errors.ts`、`capabilities.ts` 在 [adapter-interface.md](adapter-interface.md) §2、§3、§4、§9；`config.ts` 在 [architecture.md](architecture.md) §8；`labels.ts` 在 [hub-ui.md](hub-ui.md) §2；`index.ts` 只有 `export * from` 这 8 个文件。

### 4.1 DTO

```ts
// contract/src/dto.ts
import type { AgentCapabilities, AgentHealth } from './capabilities';
import type {
  AdapterKind,
  ApprovalDecision,
  ApprovalKind,
  ApprovalStatus,
  DecidedBy,
  DiffStats,
  JsonValue,
  Scope,
  StopReason,
  TaskMode,
  TaskSource,
  TaskStatus,
  TurnStatus,
  UsageInfo,
  WorkspaceKind,
} from './domain';
import type { AgentError } from './errors';

export interface TaskDto {
  id: string;
  shortId: string;
  title: string;
  agentId: string;
  adapterKind: AdapterKind;
  repoId: string;
  repoPath: string;
  source: TaskSource;
  sourceTokenId: string | null;
  externalRef: string | null;
  mode: TaskMode;
  workspace: WorkspaceKind;
  workspacePath: string | null;
  branch: string | null;
  baseRef: string | null;
  baseCommit: string | null;
  model: string | null;
  reasoningEffort: string | null;
  userVisible: boolean;
  nativeSessionId: string | null;
  remoteUrl: string | null;
  status: TaskStatus;
  pendingApprovals: number;
  turnCount: number;
  lastEventSeq: number;
  lastError: AgentError | null;
  readOnlyViolation: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  archivedAt: string | null;
  worktreeRemovedAt: string | null;
}

export interface TurnDto {
  id: string;
  taskId: string;
  index: number;
  prompt: string;
  model: string | null;
  reasoningEffort: string | null;
  status: TurnStatus;
  stopReason: StopReason | null;
  error: AgentError | null;
  nativeTurnId: string | null;
  turnStats: DiffStats | null;
  taskStats: DiffStats | null;
  patchTruncated: boolean;
  usage: UsageInfo | null;
  finalMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ApprovalDto {
  id: string;
  taskId: string;
  turnId: string;
  kind: ApprovalKind;
  /** 一句话中文标题，例如“执行命令”“修改 3 个文件”。 */
  title: string;
  command: string | null;
  cwd: string | null;
  paths: string[] | null;
  /** Agent 给出的理由。 */
  reason: string | null;
  /** 协议原始字段（脱敏后），详情面板展示。 */
  detail: JsonValue | null;
  /** 本次请求可选的决定；界面只渲染这里列出的按钮。 */
  options: ApprovalDecision[];
  status: ApprovalStatus;
  decision: ApprovalDecision | null;
  decidedBy: DecidedBy | null;
  decidedByTokenId: string | null;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
}

export interface TaskDetailDto extends TaskDto {
  turns: TurnDto[];
  approvals: ApprovalDto[];
}

export interface TaskResultDto {
  taskId: string;
  shortId: string;
  status: TaskStatus;
  /** 最近一轮；任务刚创建时也有（pending）。 */
  turn: {
    index: number;
    status: TurnStatus;
    stopReason: StopReason | null;
    error: AgentError | null;
    finalMessage: string | null;
    usage: UsageInfo | null;
  };
  /** 最近一个有快照的轮的整个任务 diff 统计；还没有任何轮结束时为 null。 */
  diff: { turnIndex: number; stats: DiffStats; patchTruncated: boolean } | null;
  pendingApprovals: number;
  readOnlyViolation: boolean;
  endedAt: string | null;
}

export interface DiffDto {
  taskId: string;
  scope: 'task' | 'turn';
  /** 对应的轮；live 时是当前轮。 */
  turnIndex: number;
  live: boolean;
  stats: DiffStats;
  /** 补丁文本；存库时超过 5 MB 或桥接方读取被截断到为空时为 null。 */
  patch: string | null;
  /** 补丁不完整：存库时超限，或按 maxBridgeDiffBytes 截断。 */
  truncated: boolean;
}

export interface AgentDto {
  id: string;
  displayName: string;
  kind: AdapterKind;
  /** 只有 acp 有。 */
  profile: string | null;
  enabled: boolean;
  health: AgentHealth;
  capabilities: AgentCapabilities | null;
  maxConcurrentTasks: number;
  runningTasks: number;
  queuedTasks: number;
}

export interface RepoRemoteDto {
  name: string;
  /** 已去掉 userinfo。 */
  fetchUrl: string | null;
  pushUrl: string | null;
}

export interface RepoInspectionDto {
  ok: boolean;
  /** 中文问题列表；ok 为 false 时至少一条。 */
  problems: string[];
  topLevel: string | null;
  currentBranch: string | null;
  head: string | null;
  dirty: boolean;
  remotes: RepoRemoteDto[];
  originPushDisabled: boolean;
  internalPushHost: string | null;
}

export interface RepoDto {
  id: string;
  name: string;
  /** 已展开 ~。 */
  path: string;
  defaultBaseRef: string | null;
  isDefault: boolean;
  inspection: RepoInspectionDto;
}

export interface ApiTokenDto {
  id: string;
  name: string;
  /** 明文前 12 个字符，如 "ahb_3kF9xQ2a"。 */
  prefix: string;
  scopes: Scope[];
  isDefault: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiTokenDto extends ApiTokenDto {
  /** 明文，只在创建时返回这一次。 */
  token: string;
}

export interface AuditDto {
  id: number;
  ts: string;
  actor: string;
  action: string;
  taskId: string | null;
  detail: JsonValue | null;
}
```

### 4.2 请求、查询与响应

```ts
// contract/src/api.ts
import { z } from 'zod';
import type { HubConfig } from './config';
import {
  APPROVAL_DECISIONS,
  APPROVAL_STATUSES,
  SCOPES,
  TASK_MODES,
  TASK_SOURCES,
  TASK_STATUSES,
  WORKSPACE_KINDS,
  type Scope,
} from './domain';
import type { ApiErrorCode } from './errors';
import type { ApprovalDto, AuditDto, TaskDto, TurnDto } from './dto';
import type { HubEventEnvelope } from './events';

export const API_PREFIX = '/api/v1';
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
export const TRUNCATED_HEADER = 'x-agent-hub-truncated';

export const WS_CLOSE_CODES = {
  SHUTDOWN: 1001,
  BAD_MESSAGE: 4400,
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  SLOW_CONSUMER: 4008,
} as const;

const prompt = z.string().trim().min(1, '提示词不能为空').max(200_000, '提示词最多 20 万字符');
const modelId = z.string().min(1).max(100);
const effortId = z.string().min(1).max(40);
const queryBool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const csvOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).min(1));

// ---- 请求体 ----

export const createTaskBodySchema = z.strictObject({
  agentId: z.string().min(1),
  /** 省略时用 config.json 的 defaultRepoId。 */
  repoId: z.string().min(1).optional(),
  prompt,
  /** 省略时取提示词第一行的前 40 个字符。 */
  title: z.string().trim().min(1).max(120).optional(),
  /** 省略时：网页 Agent 为 write，其余为 read_only。 */
  mode: z.enum(TASK_MODES).optional(),
  /** 省略时按 architecture.md §7.1 推断；桥接方的可写任务不能是 in_place。 */
  workspace: z.enum(WORKSPACE_KINDS).optional(),
  baseRef: z.string().min(1).max(200).optional(),
  model: modelId.optional(),
  reasoningEffort: effortId.optional(),
  userVisible: z.boolean().default(true),
  externalRef: z.string().min(1).max(200).optional(),
});
export type CreateTaskBody = z.input<typeof createTaskBodySchema>;

export const followUpBodySchema = z.strictObject({
  prompt,
  /** 省略 = 沿用任务当前的设置；null = 改回 Agent 默认。 */
  model: modelId.nullable().optional(),
  reasoningEffort: effortId.nullable().optional(),
});
export type FollowUpBody = z.input<typeof followUpBodySchema>;

export const cancelBodySchema = z.strictObject({ force: z.boolean().default(false) });
export const decisionBodySchema = z.strictObject({
  decision: z.enum(APPROVAL_DECISIONS),
  note: z.string().trim().max(500).optional(),
});
export const applyBodySchema = z.strictObject({ merge: z.boolean().default(false) });
export const remoteLinkBodySchema = z.strictObject({ url: z.url({ protocol: /^https?$/ }) });
export const inspectRepoBodySchema = z.strictObject({
  path: z.string().regex(/^(\/|~\/)/, '必须是绝对路径'),
});
export const createTokenBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  scopes: z
    .array(z.enum(SCOPES))
    .min(1)
    .refine((s) => new Set(s).size === s.length, 'scope 不能重复'),
});
export const updateTokenBodySchema = z.strictObject({
  scopes: createTokenBodySchema.shape.scopes,
});

// ---- 查询参数（值都是字符串，按需转换；不认识的参数忽略） ----

export const listTasksQuerySchema = z.object({
  status: csvOf(TASK_STATUSES).optional(),
  agentId: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
  source: z.enum(TASK_SOURCES).optional(),
  externalRef: z.string().min(1).max(200).optional(),
  archived: queryBool.default(false),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type ListTasksQuery = z.output<typeof listTasksQuerySchema>;

export const listEventsQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const waitQuerySchema = z.object({
  until: z.enum(['turn_end', 'approval', 'any']).default('turn_end'),
  afterSeq: z.coerce.number().int().min(0).default(0),
  timeoutSec: z.coerce.number().int().min(1).max(60).default(30),
});
export type WaitQuery = z.output<typeof waitQuerySchema>;

export const diffQuerySchema = z.object({
  scope: z.enum(['task', 'turn']).default('task'),
  /** 省略 = 最近一个已有快照的轮。 */
  turn: z.coerce.number().int().min(1).optional(),
  format: z.enum(['json', 'patch']).default('json'),
  /** 现场拍快照（只对运行中的轮有意义）。 */
  live: queryBool.default(false),
});
export type DiffQuery = z.output<typeof diffQuerySchema>;

export const listApprovalsQuerySchema = z.object({
  status: z.enum(APPROVAL_STATUSES).optional(),
  taskId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const listAuditQuerySchema = z.object({
  before: z.coerce.number().int().min(1).optional(),
  action: z.string().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// ---- 响应 ----

export interface HealthResponse {
  app: 'agent-hub';
  version: string;
}
/** 不分页的集合（agents、repos、approvals、tokens）。 */
export interface ItemsResponse<T> {
  items: T[];
}
/** 用 type 而不是 interface：要能放进 JsonValue 类型的 details。 */
export type ValidationIssue = {
  /** zod issue 的 path 用 "." 连接；根对象为 ""。 */
  path: string;
  message: string;
};
export interface TaskWithTurnResponse {
  task: TaskDto;
  turn: TurnDto;
  /** 幂等键命中：返回的是第一次创建的对象（当前状态）。 */
  replayed: boolean;
}
export interface ListTasksResponse {
  items: TaskDto[];
  nextCursor: string | null;
}
export interface ListEventsResponse {
  events: HubEventEnvelope[];
  /** 本页最后一条的 seq；没有事件时等于请求的 afterSeq。下次请求作为 afterSeq。 */
  lastSeq: number;
  hasMore: boolean;
}
export interface WaitResponse {
  reached: boolean;
  task: TaskDto;
  /** 任务当前的 lastEventSeq。 */
  lastSeq: number;
}
export interface ApplyResponse {
  branch: string;
  /** 本次新建的提交；worktree 没有未提交改动时为 null。 */
  commit: string | null;
  merged: boolean;
  mergeCommit: string | null;
}
export interface SettingsResponse {
  config: HubConfig;
  /** 改了 server.port，需要重启侧车才生效。 */
  restartRequired: boolean;
  /** AGENT_HUB_HOME 的绝对路径。 */
  dataDir: string;
  /** 默认桥接 token 文件的绝对路径。 */
  bridgeTokenFile: string;
}
export interface ListAuditResponse {
  items: AuditDto[];
  /** 下一页请求的 before；没有更多时为 null。 */
  nextBefore: number | null;
}
export interface DiagnosticsResponse {
  /** 生成的 .tar.gz 绝对路径。 */
  file: string;
}
export interface MeResponse {
  kind: 'ui' | 'bridge';
  tokenId: string | null;
  scopes: Scope[];
  admin: boolean;
}

// ---- WebSocket ----

const subId = z.string().min(1).max(64);

export const wsClientMessageSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('auth'), token: z.string().min(1) }),
  z.discriminatedUnion('topic', [
    z.strictObject({ op: z.literal('subscribe'), id: subId, topic: z.literal('tasks') }),
    z.strictObject({
      op: z.literal('subscribe'),
      id: subId,
      topic: z.literal('task'),
      taskId: z.string().min(1),
      afterSeq: z.number().int().min(0).default(0),
    }),
  ]),
  z.strictObject({ op: z.literal('unsubscribe'), id: subId }),
  z.strictObject({ op: z.literal('ping') }),
]);
export type WsClientMessage = z.input<typeof wsClientMessageSchema>;

export type WsServerMessage =
  | { op: 'ready'; kind: 'ui' | 'bridge'; scopes: Scope[]; admin: boolean }
  | { op: 'subscribed'; id: string }
  | ({ op: 'event'; id: string } & HubEventEnvelope)
  | { op: 'task'; id: string; task: TaskDto }
  | { op: 'approval'; id: string; approval: ApprovalDto }
  | { op: 'pong' }
  | { op: 'error'; id?: string; code: ApiErrorCode; message: string };
```

### 4.3 DTO 的组装

行到 DTO 的通用规则见 [data-model.md](data-model.md) §4.1。其余规则：

| DTO / 字段                         | 规则                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskDto.title`                    | 创建时没给就取提示词第一行，按 Unicode 字符取前 40 个，截断时末尾加 `…`。                                                               |
| `TaskDetailDto.turns`              | 按 `index` 升序。                                                                                                                       |
| `TaskDetailDto.approvals`          | 该任务全部审批，按 `createdAt` 升序。                                                                                                   |
| `TaskResultDto.turn`               | `index` 最大的轮（任务刚创建时就是 `pending` 的第 1 轮）。                                                                              |
| `TaskResultDto.diff`               | `task_stats` 不为空的轮里 `index` 最大的一个：`{ turnIndex, stats: taskStats, patchTruncated }`；没有这样的轮时为 `null`。              |
| `AgentDto.runningTasks`            | 该 Agent 处于 `preparing` / `running` 的任务数；`queuedTasks` 是 `queued` 的任务数。                                                    |
| `AgentDto.health` / `capabilities` | `AdapterRegistry` 的缓存（[adapter-interface.md](adapter-interface.md) §9）；禁用的 Agent 为 `{ status: 'disabled' }` 和 `null`。       |
| `RepoDto.inspection`               | `RepoInspector` 的结果，每个仓库缓存 10 秒；`GET /repos?refresh=1` 跳过缓存。`isDefault` = `id === defaultRepoId`。                     |
| `ApprovalDto.title`                | 适配器给出的中文标题（[adapter-interface.md](adapter-interface.md) §5）。                                                               |
| `MeResponse`                       | UI token：`{ kind: 'ui', tokenId: null, scopes: 全部, admin: true }`；桥接 token：`{ kind: 'bridge', tokenId, scopes, admin: false }`。 |

## 5. 端点

### 5.1 一览

路径都省略前缀 `/api/v1`。“权限”列：**公开** = `@Public()`；**任意** = `@Scopes()`；scope 名 = `@Scopes(名)`；**管理** = 不加标注；“+ 归属”= 桥接 token 还要求任务是自己创建的（§2.3）。

| 方法与路径                                | 权限                      | 输入                                      | 成功响应                                          |
| ----------------------------------------- | ------------------------- | ----------------------------------------- | ------------------------------------------------- |
| `GET /health`                             | 公开                      | —                                         | `200 HealthResponse`                              |
| `GET /me`                                 | 任意                      | —                                         | `200 MeResponse`                                  |
| `GET /agents`                             | `tasks:read`              | —                                         | `200 ItemsResponse<AgentDto>`                     |
| `POST /agents/:agentId/refresh`           | 管理                      | —                                         | `200 AgentDto`                                    |
| `GET /repos`                              | `tasks:read`              | `?refresh=1`                              | `200 ItemsResponse<RepoDto>`                      |
| `GET /repos/:repoId/refs`                 | `tasks:read`              | —                                         | `200 ItemsResponse<string>`                       |
| `POST /repos/inspect`                     | 管理                      | `inspectRepoBodySchema`                   | `200 RepoInspectionDto`                           |
| `POST /repos/:repoId/disable-origin-push` | 管理                      | —                                         | `200 RepoDto`                                     |
| `POST /tasks`                             | `tasks:write`             | `createTaskBodySchema`，`Idempotency-Key` | `201`（命中幂等键为 `200`）`TaskWithTurnResponse` |
| `GET /tasks`                              | `tasks:read`              | `listTasksQuerySchema`                    | `200 ListTasksResponse`                           |
| `GET /tasks/:id`                          | `tasks:read`              | —                                         | `200 TaskDetailDto`                               |
| `GET /tasks/:id/events`                   | `tasks:read`              | `listEventsQuerySchema`                   | `200 ListEventsResponse`                          |
| `GET /tasks/:id/wait`                     | `tasks:read`              | `waitQuerySchema`                         | `200 WaitResponse`                                |
| `GET /tasks/:id/result`                   | `tasks:read`              | —                                         | `200 TaskResultDto`                               |
| `GET /tasks/:id/diff`                     | `tasks:read`              | `diffQuerySchema`                         | `200 DiffDto`，或 `text/x-diff`                   |
| `POST /tasks/:id/turns`                   | `tasks:write` + 归属      | `followUpBodySchema`，`Idempotency-Key`   | `201`（命中幂等键为 `200`）`TaskWithTurnResponse` |
| `POST /tasks/:id/cancel`                  | `tasks:write` + 归属      | `cancelBodySchema`                        | `200 TaskDto`                                     |
| `POST /tasks/:id/archive`                 | `tasks:write` + 归属      | —                                         | `200 TaskDto`                                     |
| `POST /tasks/:id/unarchive`               | `tasks:write` + 归属      | —                                         | `200 TaskDto`                                     |
| `DELETE /tasks/:id`                       | 管理                      | —                                         | `204`                                             |
| `POST /tasks/:id/apply`                   | 管理                      | `applyBodySchema`                         | `200 ApplyResponse`                               |
| `POST /tasks/:id/remote/done`             | 管理                      | —                                         | `200 TaskDto`                                     |
| `POST /tasks/:id/remote/link`             | 管理                      | `remoteLinkBodySchema`                    | `200 TaskDto`                                     |
| `GET /approvals`                          | `tasks:read`              | `listApprovalsQuerySchema`                | `200 ItemsResponse<ApprovalDto>`                  |
| `POST /approvals/:approvalId/decision`    | `approvals:decide` + 归属 | `decisionBodySchema`                      | `200 ApprovalDto`                                 |
| `GET /settings`                           | 管理                      | —                                         | `200 SettingsResponse`                            |
| `PUT /settings`                           | 管理                      | `HubConfigInput`（`hubConfigSchema`）     | `200 SettingsResponse`                            |
| `GET /tokens`                             | 管理                      | —                                         | `200 ItemsResponse<ApiTokenDto>`                  |
| `POST /tokens`                            | 管理                      | `createTokenBodySchema`                   | `201 CreatedApiTokenDto`                          |
| `PATCH /tokens/:tokenId`                  | 管理                      | `updateTokenBodySchema`                   | `200 ApiTokenDto`                                 |
| `POST /tokens/:tokenId/revoke`            | 管理                      | —                                         | `200 ApiTokenDto`                                 |
| `POST /tokens/rotate-default`             | 管理                      | —                                         | `201 CreatedApiTokenDto`                          |
| `POST /diagnostics/export`                | 管理                      | —                                         | `200 DiagnosticsResponse`                         |
| `GET /audit`                              | 管理                      | `listAuditQuerySchema`                    | `200 ListAuditResponse`                           |
| `GET /ws`                                 | 握手见 §6.1               | WebSocket                                 | `101`                                             |

所有 `/tasks/:id/*` 先按 id 或短号取任务，取不到 → `404 TASK_NOT_FOUND`；需要归属的接口接着检查归属。

### 5.2 创建任务 `POST /tasks`

请求示例（桥接方）：

```http
POST /api/v1/tasks HTTP/1.1
Host: 127.0.0.1:47821
Authorization: Bearer ahb_…
Content-Type: application/json
Idempotency-Key: conv_7f3a:msg_12

{
  "agentId": "codex",
  "prompt": "分析 apps/cardhub/api 冷启动慢的原因。只读，不要改文件。",
  "reasoningEffort": "high",
  "externalRef": "conv_7f3a"
}
```

`TaskService.create(principal, rawBody, idempotencyKey)` 按顺序执行，任何一步失败立即返回：

| 步骤 | 检查 / 动作                                                                                                                                                                                 | 失败                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1    | `parseInput(createTaskBodySchema, rawBody)`；`Idempotency-Key` 格式。                                                                                                                       | `400 VALIDATION_FAILED`                                             |
| 2    | 幂等键查找（§3.3）：命中则直接返回回放结果。                                                                                                                                                | `409 IDEMPOTENCY_CONFLICT`                                          |
| 3    | `agentId` 在配置里 → 否则 404；`enabled` → 否则 409。**不看健康状态**：Agent 未登录或找不到命令时任务照常创建，在准备阶段失败并带上明确的错误码（如 `AGENT_AUTH_REQUIRED`），列表里看得见。 | `404 AGENT_NOT_FOUND` / `409 AGENT_DISABLED`                        |
| 4    | `repoId ?? config.defaultRepoId`：两者都没有 → 400；不在配置里 → 404；仓库体检 `ok` 为 `false` → 400（`details.problems`）。                                                                | `400 VALIDATION_FAILED` / `404 REPO_NOT_FOUND` / `400 REPO_INVALID` |
| 5    | 确定 `mode` 与 `workspace`（下表）。                                                                                                                                                        | `400 VALIDATION_FAILED` / `403 BRIDGE_IN_PLACE_WRITE_FORBIDDEN`     |
| 6    | `baseRef`：`in_place` 不能带（400）；带了就 `git rev-parse --verify --quiet --end-of-options "<baseRef>^{commit}"`，失败 → 400（`path: "baseRef"`，“基线不存在”）。                         | `400 VALIDATION_FAILED`                                             |
| 7    | 模型与推理档：见下文。                                                                                                                                                                      | `400 MODEL_NOT_SUPPORTED`                                           |
| 8    | 排队中的任务数 ≥ `scheduler.maxQueuedTasks`。                                                                                                                                               | `503 QUEUE_FULL`                                                    |
| 9    | 同步事务：再查一次幂等键（§3.3 并发）；插入任务（`queued`）、第 1 轮（`pending`）、幂等键。                                                                                                 | —                                                                   |
| 10   | 广播 `task` 对象变化（§6.2）；通知调度器。                                                                                                                                                  | —                                                                   |

**模式与工作区**（第 5 步）：

| Agent 类型      | `mode` 省略时 | `workspace` 省略时                   | 允许的 `workspace`     | 其他限制                                                                                                |
| --------------- | ------------- | ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `codex` / `acp` | `read_only`   | 只读 → `in_place`；可写 → `worktree` | `in_place`、`worktree` | 桥接方 + 可写 + `in_place` → `403 BRIDGE_IN_PLACE_WRITE_FORBIDDEN`（D45）；界面可以（对话框二次确认）。 |
| `web`           | `write`       | `remote_branch`                      | `remote_branch`        | `mode: "read_only"` → 400“网页 Agent 只支持可写任务”。                                                  |

“允许的 `workspace`”之外的取值 → `400 VALIDATION_FAILED`（`path: "workspace"`）。

**模型与推理档**（第 7 步）。先取 Agent 当前缓存的能力 `caps`：

- `caps.modelsSource === 'none'`（网页 Agent）：带了 `model` 或 `reasoningEffort` → `MODEL_NOT_SUPPORTED`。
- `caps.models` 为空（ACP 还没有过会话）：不校验，原样交给 Agent；Agent 不认时该轮失败（`AgentErrorCode` 的 `MODEL_NOT_SUPPORTED`）。
- 否则：`model` 必须是某个 `ModelOption.id`；`reasoningEffort` 必须在“生效的模型”（`model ?? 配置的 defaultModel ?? isDefault 为 true 的模型`）的 `reasoningEfforts` 里；生效的模型找不到时只校验 `model`。
- 省略时写入配置里的 `defaultModel` / `defaultReasoningEffort`（可能是 `null`，表示用 Agent 自己的默认值）。

其余字段：`title` 按 §4.3 生成；`userVisible` 照存（只有 Codex 用到，D31）；`source` = `ui` / `bridge`；`sourceTokenId` = 桥接 token id 或 `null`；`repoPath` = 仓库路径（`~` 已展开）。

成功响应 `201`：

```json
{
  "task": {
    "id": "5f0c2a9e-6b1d-4c8e-9a7f-3d2b1c0e9f84",
    "shortId": "5f0c2a9e",
    "title": "分析 apps/cardhub/api 冷启动慢的原因。只读，不要改文件。",
    "agentId": "codex",
    "adapterKind": "codex",
    "repoId": "multi-apps",
    "repoPath": "/Users/jq/code/multi-apps",
    "source": "bridge",
    "sourceTokenId": "0c1f…",
    "externalRef": "conv_7f3a",
    "mode": "read_only",
    "workspace": "in_place",
    "workspacePath": "/Users/jq/code/multi-apps",
    "branch": null,
    "baseRef": null,
    "baseCommit": null,
    "model": null,
    "reasoningEffort": "high",
    "userVisible": true,
    "nativeSessionId": null,
    "remoteUrl": null,
    "status": "queued",
    "pendingApprovals": 0,
    "turnCount": 1,
    "lastEventSeq": 0,
    "lastError": null,
    "readOnlyViolation": false,
    "createdAt": "2026-10-28T03:15:00.000Z",
    "updatedAt": "2026-10-28T03:15:00.000Z",
    "startedAt": null,
    "endedAt": null,
    "archivedAt": null,
    "worktreeRemovedAt": null
  },
  "turn": { "id": "…", "taskId": "5f0c2a9e-…", "index": 1, "status": "pending", "…": "…" },
  "replayed": false
}
```

### 5.3 列表、详情与事件

**`GET /tasks`**：

- 过滤：`status`（逗号分隔，如 `running,queued`）、`agentId`、`repoId`、`source`、`externalRef`、`archived`（默认 `false`，即只列未归档的；`true` 只列已归档的）、`q`（标题子串，不区分大小写）。
- 按 `createdAt` 倒序；`limit` 默认 50、最大 200；`nextCursor` 原样作为下一页的 `cursor`。游标是 base64url 编码的 `"<createdAt>|<id>"`，解不开 → `400 VALIDATION_FAILED`。SQL 见 [data-model.md](data-model.md) §4.3。

**`GET /tasks/:id`**：`TaskDetailDto`（任务 + 全部轮 + 全部审批）。

**`GET /tasks/:id/events?afterSeq=0&limit=500`**：

- 返回 `seq > afterSeq` 的事件，按 `seq` 升序，最多 `limit` 条（最大 1000）。
- `lastSeq` = 本页最后一条的 `seq`，没有事件时等于请求的 `afterSeq`；下次请求把它作为 `afterSeq`。`hasMore` 表示后面还有。
- `seq` 只保证递增，**不保证连续**（保留策略会删掉旧的增量事件，[architecture.md](architecture.md) §6）。

### 5.4 追问、取消、归档、删除

**追问 `POST /tasks/:id/turns`**，`{ prompt, model?, reasoningEffort? }`：

| 步骤 | 检查 / 动作                                                                                                                                                                                   | 失败                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1    | 解析请求体；取任务；归属。                                                                                                                                                                    | 400 / 404 / `403 TASK_NOT_OWNED`                                    |
| 2    | 幂等键查找（§3.3）。                                                                                                                                                                          | `409 IDEMPOTENCY_CONFLICT`                                          |
| 3    | 已归档。                                                                                                                                                                                      | `409 TASK_ARCHIVED`                                                 |
| 4    | 不在终态（`queued` / `preparing` / `running`）。                                                                                                                                              | `409 TASK_BUSY`                                                     |
| 5    | `worktreeRemovedAt` 不为空（worktree 已被保留策略移除）。                                                                                                                                     | `409 WORKSPACE_REMOVED`                                             |
| 6    | Agent 还在配置里、已启用；仓库还在配置里。                                                                                                                                                    | `404 AGENT_NOT_FOUND` / `409 AGENT_DISABLED` / `404 REPO_NOT_FOUND` |
| 7    | 模型与推理档，规则同 §5.2；`model` 省略 = 沿用任务当前值，`null` = 改回 Agent 默认；`reasoningEffort` 同理。                                                                                  | `400 MODEL_NOT_SUPPORTED`                                           |
| 8    | 排队已满。                                                                                                                                                                                    | `503 QUEUE_FULL`                                                    |
| 9    | 同步事务：新轮（`pending`，`index = turnCount + 1`，写入生效的模型与推理档）；任务 → `queued`（`task.status` 事件），更新 `model`、`reasoningEffort`、`turnCount`，清空 `lastError`；幂等键。 | —                                                                   |

`interrupted`、`failed`、`cancelled` 的任务都可以追问；恢复原生会话见 [architecture.md](architecture.md) §3.4。

**取消 `POST /tasks/:id/cancel`**，`{ force?: boolean }`：按 [architecture.md](architecture.md) §3.3 执行。`queued` 的任务在响应前就已是 `cancelled`；`preparing` / `running` 的任务**立即返回当前状态**，最终状态通过 `wait` 或 WebSocket 得知。已在终态 → 什么都不做，返回 `200` 和当前任务（重试安全）。

**归档 `POST /tasks/:id/archive`**：不在终态 → `409 TASK_BUSY`；已归档 → 什么都不做。写 `archivedAt`。
**取消归档 `POST /tasks/:id/unarchive`**：没归档 → 什么都不做。清空 `archivedAt`。

**删除 `DELETE /tasks/:id`**（管理）：没归档 → `409 TASK_NOT_ARCHIVED`。删除内容与顺序见 [data-model.md](data-model.md) §6，返回 `204`。

### 5.5 长轮询 `GET /tasks/:id/wait`

给不方便维持 WebSocket 的调用方（例如以“工具调用”方式工作的聊天 Bot，D47）。

`?until=turn_end|approval|any&afterSeq=<seq>&timeoutSec=<1–60，默认 30>`

| `until`    | 满足条件（请求到达时先判断一次，之后该任务每次有新事件或任务变化时再判断） |
| ---------- | -------------------------------------------------------------------------- |
| `turn_end` | 任务处于终态。                                                             |
| `approval` | `pendingApprovals > 0`，或任务处于终态（免得等一个永远不会来的审批）。     |
| `any`      | `lastEventSeq > afterSeq`。                                                |

- 满足时立即返回 `{ reached: true, task, lastSeq }`；到 `timeoutSec` 仍未满足返回 `{ reached: false, task, lastSeq }`，HTTP 状态都是 `200`。调用方再取 `/result`、`/events` 或继续等。
- `turn_end` 不看 `afterSeq`。追问请求在返回前已经把任务改成 `queued`，所以“追问 → 立即 wait”不会误判为已结束。
- 实现：先订阅 `EventBus` 上该任务的事件与任务变化，**再**判断条件（避免两步之间漏掉变化）；客户端断开（`req.on('close')`）、侧车停机（立即 `reached: false`）、超时三种情况都要取消订阅。
- 每个桥接 token 同时挂起的 `wait` 最多 16 个，超出 → `429 RATE_LIMITED`。

### 5.6 结果 `GET /tasks/:id/result`

`TaskResultDto`（组装规则见 §4.3）。本地郎在 `wait` 返回后取它，用 `turn.finalMessage` 回复用户，用 `diff.stats` 概述改动。

```json
{
  "taskId": "5f0c2a9e-6b1d-4c8e-9a7f-3d2b1c0e9f84",
  "shortId": "5f0c2a9e",
  "status": "completed",
  "turn": {
    "index": 1,
    "status": "completed",
    "stopReason": "end_turn",
    "error": null,
    "finalMessage": "冷启动慢主要有三个原因：……",
    "usage": { "inputTokens": 48211, "outputTokens": 1630, "totalTokens": 49841 }
  },
  "diff": {
    "turnIndex": 1,
    "stats": { "filesChanged": 0, "insertions": 0, "deletions": 0, "files": [] },
    "patchTruncated": false
  },
  "pendingApprovals": 0,
  "readOnlyViolation": false,
  "endedAt": "2026-10-28T03:18:42.120Z"
}
```

### 5.7 diff `GET /tasks/:id/diff`

`?scope=task|turn&turn=<index>&format=json|patch&live=true|false`

| 参数     | 含义                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope`  | `task`（默认）= 从任务基线到该轮结束；`turn` = 只看该轮。                                                                                                                                                                         |
| `turn`   | 轮的 `index`；省略 = 已有快照的最近一轮。指定的轮不存在 → `404 TURN_NOT_FOUND`；存在但还没有快照（未结束）→ `404 DIFF_NOT_AVAILABLE`。                                                                                            |
| `live`   | 只在任务 `running` 时有效：现场拍快照（[architecture.md](architecture.md) §7.2），`turnIndex` 为当前轮，追加一条 `diff.updated`（`scope: "live"`）。任务不在 `running` 时忽略此参数。同一任务同一时刻只拍一次，并发请求共享结果。 |
| `format` | `json`（默认）→ `DiffDto`；`patch` → `Content-Type: text/x-diff; charset=utf-8`，响应体是补丁文本（没有改动时为空），响应头 `X-Agent-Hub-Truncated` 为 `true` 或 `false`。                                                        |

- 一个轮都没结束且不是 `live` → `404 DIFF_NOT_AVAILABLE`。
- 存库的补丁超过 5 MB 时只有统计（`patch: null`、`truncated: true`）；现场快照的补丁同样按 5 MB 处理。
- 网页 Agent 任务的 `live` 是立即拉取一次远端任务分支（[web-agent.md](web-agent.md) §4）。
- 桥接方：脱敏、512 KB 截断、审计（§3.4）。

### 5.8 审批

**`GET /approvals?status=&taskId=&limit=`**：按 `createdAt` 倒序，`limit` 默认 100、最大 200。Hub UI 启动时取 `status=pending` 的全部审批，之后靠 WebSocket 更新（[hub-ui.md](hub-ui.md) §4）。

**`POST /approvals/:approvalId/decision`**，`{ decision, note? }`：

| 步骤 | 检查 / 动作                                                                                                                                                                                                    | 失败                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1    | 审批存在。                                                                                                                                                                                                     | `404 APPROVAL_NOT_FOUND`   |
| 2    | 桥接 token：审批所属任务是自己创建的。                                                                                                                                                                         | `403 TASK_NOT_OWNED`       |
| 3    | `decision` 在该审批的 `options` 里。                                                                                                                                                                           | `400 VALIDATION_FAILED`    |
| 4    | `ApprovalService.decide()`：同步事务里结束审批（只改 `pending` 的行，[data-model.md](data-model.md) §4.3）、`pendingApprovals − 1`、写审计 `approval.decided`、追加 `approval.resolved` 事件；没改到行 → 409。 | `409 APPROVAL_NOT_PENDING` |
| 5    | 把决定交还给等待中的适配器（[adapter-interface.md](adapter-interface.md) §5）。`cancel_turn` 另外对该任务执行一次非强制取消（§5.4）。                                                                          | —                          |

审批状态：`allow_once` / `allow_for_session` → `approved`；`reject` / `cancel_turn` → `rejected`。`decidedBy` = `ui` 或 `bridge`，`decidedByTokenId` = 桥接 token id。返回结束后的 `ApprovalDto`。

### 5.9 应用改动与网页任务（管理）

**`POST /tasks/:id/apply`**，`{ merge?: boolean }`：任务不在终态 → `409 TASK_BUSY`；`in_place` → `409 APPLY_NOT_SUPPORTED`；其余按 [architecture.md](architecture.md) §7.4 与 [web-agent.md](web-agent.md) §4 执行。返回 `ApplyResponse`：`commit` 是本次新建的提交（没有未提交改动时为 `null`），`merged` 表示本次产生了合并提交。可能的错误：`GIT_IDENTITY_MISSING`、`NOTHING_TO_APPLY`、`WORKSPACE_DIRTY`、`MERGE_CONFLICT`；其他 git 失败 → `INTERNAL`（stderr 末尾 2 KB 脱敏后进日志）。写审计 `git.apply`。

**`POST /tasks/:id/remote/done`**：网页 Agent 任务的“完成本轮”。不是网页任务，或任务不在 `running` → `409 ILLEGAL_TRANSITION`。立即拉取一次远端任务分支，然后以 `end_turn` 结束本轮（[web-agent.md](web-agent.md) §3）。返回任务当前状态。

**`POST /tasks/:id/remote/link`**，`{ url }`：记录 AoneD 会话链接（`remoteUrl`），只接受 `http` / `https`。不是网页任务 → `409 ILLEGAL_TRANSITION`。任何状态都可以改。

### 5.10 管理接口

| 接口                                      | 行为                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /settings`                           | 当前 `config.json` 解析后的值，加上 `dataDir`、`bridgeTokenFile`；`restartRequired: false`。                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PUT /settings`                           | 请求体是**完整的**配置（`HubConfigInput`）。① `parseInput(hubConfigSchema, body, 'CONFIG_INVALID')`；② 对新增或改了路径的仓库做体检，不是 git 仓库顶层 → `400 REPO_INVALID`（`details: { repoId, problems }`）；③ 由 `internal` 远端的推送地址推导 `allowedPushHosts`（请求里的值被忽略），推导结果在 `security.blockedPushHosts` 里 → `400 REPO_INVALID`；④ 原子写文件；⑤ 热更新（[architecture.md](architecture.md) §8）；⑥ 审计 `config.changed`（只记改了哪些顶层键）。`restartRequired` = `server.port` 变了。 |
| `GET /repos/:repoId/refs`                 | 基线下拉框用：`git for-each-ref --sort=-committerdate --count=200 --format='%(refname:short)' refs/heads refs/remotes refs/tags`。                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST /repos/inspect`                     | 设置页“检测”按钮：对任意路径做体检（不要求已注册），返回 `RepoInspectionDto`。                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /repos/:repoId/disable-origin-push` | `git -C <repo> remote set-url --push origin DISABLED`（D49），审计 `repo.origin_push_disabled`，返回刷新后的 `RepoDto`。没有 `origin` 远端时什么都不做。设置页新增仓库时“禁用 origin 推送”默认勾选，保存设置成功后由 Hub UI 调用。                                                                                                                                                                                                                                                                                  |
| `POST /agents/:agentId/refresh`           | 重新做健康检查并刷新能力（Codex 重新 `model/list`），返回 `AgentDto`。                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /tokens`                             | 全部桥接 token（含已吊销的），按创建时间倒序。                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /tokens`                            | 新建桥接 token（`isDefault: false`），**明文只在这个响应里出现一次**；审计 `token.created`。                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PATCH /tokens/:tokenId`                  | 改 scope；已吊销 → `409 ILLEGAL_TRANSITION`；审计 `token.scopes_changed`。加 `approvals:decide` 前由 Hub UI 弹二次确认。                                                                                                                                                                                                                                                                                                                                                                                            |
| `POST /tokens/:tokenId/revoke`            | 写 `revokedAt`（已吊销则什么都不做）；断开该 token 的 WebSocket（`4401`）；审计 `token.revoked`。吊销默认 token 后不会自动再建（§2.2）。                                                                                                                                                                                                                                                                                                                                                                            |
| `POST /tokens/rotate-default`             | 同步事务里：吊销当前未吊销的默认 token（如果有）；新建默认 token（scope 沿用旧的，没有旧的就用 `tasks:read`、`tasks:write`）；把旧 token 的任务归属（`tasks.source_token_id`）和幂等键（`idempotency_keys.token_id`）转给新 token。事务提交后原子重写 `bridge-token` 文件；审计 `token.revoked` 与 `token.created`。                                                                                                                                                                                                |
| `POST /diagnostics/export`                | 生成诊断包（[architecture.md](architecture.md) §11），返回文件路径；审计 `diagnostics.exported`。                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET /audit?before=&action=&limit=`       | 按 `id` 倒序；`before` 是上一页最后一条的 `id`；`nextBefore` 为 `null` 表示没有更多。                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 6. WebSocket `/api/v1/ws`

实时推送给 Hub UI（任务列表、详情页输出、审批角标）和可选的桥接方。消息类型见 §4.2 的 `WsClientMessage` / `WsServerMessage`，全部是一条 WebSocket 文本帧一个 JSON 对象。

### 6.1 连接与鉴权

`WsGateway.attach(httpServer)` 创建 `new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })`，在 `upgrade` 事件里：

1. 路径不是 `/api/v1/ws` → 回 `404` 并关闭 socket。
2. 与 HTTP 相同的 Host / Origin / 停机检查（§2.1），失败回对应的 HTTP 状态码。
3. 握手带了 `Authorization` 头（Node 客户端）：校验失败回 `401`；桥接 token 已有 8 个连接 → `429`。
4. `wss.handleUpgrade(...)`。握手没带 `Authorization` 头（浏览器里的 Hub UI 无法设置 WebSocket 请求头）时，连接后 **5 秒**内第一条消息必须是 `{ "op": "auth", "token": "…" }`，否则以 `4401` 关闭。
5. 鉴权通过后，主体没有 `tasks:read` → `4403` 关闭；否则发送 `{ "op": "ready", "kind": "ui", "scopes": [...], "admin": true }`。`ready` 之前客户端只能发 `auth`；`ready` 之后再发 `auth` → `4400`。

### 6.2 订阅

客户端消息（`id` 由客户端起，1–64 字符，同一连接内唯一；一个连接最多 50 个订阅）：

```json
{ "op": "subscribe", "id": "list", "topic": "tasks" }
{ "op": "subscribe", "id": "t-5f0c2a9e", "topic": "task", "taskId": "5f0c2a9e", "afterSeq": 120 }
{ "op": "unsubscribe", "id": "t-5f0c2a9e" }
{ "op": "ping" }
```

| 主题    | 推送                                                                                                                                                                  | 回放                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `tasks` | 任意任务的 DTO 有变化 → `{ "op": "task", "id", "task": TaskDto }`；任意审批新建或结束 → `{ "op": "approval", "id", "approval": ApprovalDto }`。对象是变化后的完整值。 | 没有。客户端先订阅、再用 REST 拉列表；同一任务以 `updatedAt` 较新的为准。 |
| `task`  | 该任务的事件 → `{ "op": "event", "id", "taskId", "seq", "turnId", "ts", "event" }`（即 `HubEventEnvelope` 平铺）。`taskId` 接受短号，推送里是完整 id。                | `seq > afterSeq` 的事件（§6.3）。                                         |

- 订阅成功先回 `{ "op": "subscribed", "id" }`，之后才有该订阅的推送。
- 订阅失败回 `{ "op": "error", "id", "code", "message" }`，连接保持：任务不存在 `TASK_NOT_FOUND`；`id` 重复或超过 50 个 `VALIDATION_FAILED`。订阅中的任务被删除时也回一条 `TASK_NOT_FOUND` 并结束该订阅。
- 取消不存在的订阅 id 忽略；`ping` 回 `{ "op": "pong" }`。
- 不能解析的 JSON、不符合 `wsClientMessageSchema` 的消息 → 以 `4400` 关闭。
- 发给桥接 token 的每条消息先经过 `mapStrings(msg, redact)`（§3.4）。
- 任务删除没有专门的推送：删除只能由 Hub UI 发起，UI 自己更新缓存。

### 6.3 回放与衔接

带 `afterSeq` 订阅 `task` 时，先订阅实时事件并缓冲，再分页从库里回放 `seq > afterSeq` 的事件，最后输出缓冲里更新的部分；之后直接转发。按 `seq` 去重，衔接处不重不漏。断线后客户端用最后收到的 `seq` 重新订阅即可。实时流与库里是同一份已合并的事件（[architecture.md](architecture.md) §6），回放与实时看到的内容一致。

```ts
// server/src/api/ws/replay.ts
import type { HubEventEnvelope } from '@agent-hub/contract';

export interface EventFeed {
  /** seq > afterSeq 的事件，按 seq 升序，最多 limit 条（events.repo 的 listEvents）。 */
  list(taskId: string, afterSeq: number, limit: number): HubEventEnvelope[];
  /** 订阅该任务落库之后广播的事件（EventBus）；返回取消函数。 */
  subscribe(taskId: string, listener: (env: HubEventEnvelope) => void): () => void;
}

const PAGE = 500;

/**
 * 先订阅实时事件并缓冲，再分页回放库里 seq > afterSeq 的事件，最后输出缓冲里更新的部分，
 * 之后直接转发。按 seq 去重，衔接处不重不漏。
 * send 在数据写入 socket 后 resolve（背压），连接断开时也要 resolve，不能 reject。
 */
export async function replayThenFollow(
  feed: EventFeed,
  taskId: string,
  afterSeq: number,
  send: (env: HubEventEnvelope) => Promise<void>,
  signal: AbortSignal,
): Promise<() => void> {
  let lastSent = afterSeq;
  let buffered: HubEventEnvelope[] | null = [];
  let tail: Promise<void> = Promise.resolve();
  const push = (env: HubEventEnvelope): void => {
    if (env.seq <= lastSent) return;
    lastSent = env.seq;
    tail = tail.then(() => send(env));
  };
  const unsubscribe = feed.subscribe(taskId, (env) => {
    if (buffered) buffered.push(env);
    else push(env);
  });
  try {
    for (;;) {
      if (signal.aborted) break;
      const page = feed.list(taskId, lastSent, PAGE);
      for (const env of page) push(env);
      await tail;
      if (page.length < PAGE) break;
    }
    const pending = buffered;
    buffered = null;
    for (const env of pending) push(env);
  } catch (err) {
    unsubscribe();
    throw err;
  }
  return unsubscribe;
}
```

`send` 的实现：`new Promise((resolve) => ws.send(JSON.stringify(msg), () => resolve()))`，出错也 resolve。`unsubscribe` 或连接关闭时调用 `AbortController.abort()` 并执行返回的取消函数。

### 6.4 心跳、背压与关闭

- 服务端每 **20 秒**发一次 WebSocket ping 帧，**60 秒**内没收到 pong 就 `terminate()`。
- 每次发送前检查 `ws.bufferedAmount`，超过 **8 MB** → 以 `4008` 关闭（消费太慢）；客户端应带 `afterSeq` 重连。
- 侧车停机时所有连接以 `1001` 关闭。

| 关闭码 | 常量                           | 含义                                          | 客户端应当             |
| ------ | ------------------------------ | --------------------------------------------- | ---------------------- |
| `1001` | `WS_CLOSE_CODES.SHUTDOWN`      | 侧车停机                                      | 稍后重连               |
| `4400` | `WS_CLOSE_CODES.BAD_MESSAGE`   | 消息格式错误                                  | 修正代码，不要重连     |
| `4401` | `WS_CLOSE_CODES.UNAUTHORIZED`  | 未鉴权、token 无效或已吊销、5 秒内没有 `auth` | 重新取 token 后再连    |
| `4403` | `WS_CLOSE_CODES.FORBIDDEN`     | 没有 `tasks:read`                             | 不要重连               |
| `4008` | `WS_CLOSE_CODES.SLOW_CONSUMER` | 待发送数据超过 8 MB                           | 带 `afterSeq` 立即重连 |

## 7. 错误码

HTTP 接口与 WebSocket `error` 消息共用 `ApiErrorCode`（`contract/src/errors.ts`）。轮失败的原因是另一套 `AgentErrorCode`（出现在 `TurnDto.error`、`TaskDto.lastError`），见 [adapter-interface.md](adapter-interface.md) §4，两者不混用。

| code                              | HTTP | 含义                                                                | 出现在                                |
| --------------------------------- | ---- | ------------------------------------------------------------------- | ------------------------------------- |
| `UNAUTHORIZED`                    | 401  | 没有 token、格式不对、无效或已吊销                                  | 除 `/health` 外的全部接口             |
| `FORBIDDEN_SCOPE`                 | 403  | token 缺少该接口需要的 scope（`details.required`）                  | 带 scope 的接口                       |
| `ADMIN_ONLY`                      | 403  | 管理接口，只有 Hub UI 能调                                          | 管理接口                              |
| `TASK_NOT_OWNED`                  | 403  | 桥接 token 操作不是自己创建的任务                                   | 追问、取消、归档、审批                |
| `ORIGIN_FORBIDDEN`                | 403  | `Origin` 不在白名单                                                 | 全部                                  |
| `BRIDGE_IN_PLACE_WRITE_FORBIDDEN` | 403  | 桥接方创建原目录可写任务（D45）                                     | 创建任务                              |
| `HOST_FORBIDDEN`                  | 421  | `Host` 头不是 `127.0.0.1:<port>` / `localhost:<port>`               | 全部                                  |
| `VALIDATION_FAILED`               | 400  | 请求体、查询参数、幂等键不合法，或不是合法 JSON（`details.issues`） | 全部                                  |
| `MODEL_NOT_SUPPORTED`             | 400  | 模型或推理档不在该 Agent 的能力列表里；网页 Agent 带了模型          | 创建任务、追问                        |
| `REPO_INVALID`                    | 400  | 仓库体检不通过；`internal` 推送主机被禁                             | 创建任务、`PUT /settings`             |
| `CONFIG_INVALID`                  | 400  | 配置不符合 schema（`details.issues`）                               | `PUT /settings`                       |
| `NOT_FOUND`                       | 404  | 路由不存在                                                          | —                                     |
| `TASK_NOT_FOUND`                  | 404  | 任务不存在                                                          | `/tasks/:id/*`、WS 订阅               |
| `TURN_NOT_FOUND`                  | 404  | 指定的轮不存在                                                      | diff                                  |
| `APPROVAL_NOT_FOUND`              | 404  | 审批不存在                                                          | 审批决定                              |
| `AGENT_NOT_FOUND`                 | 404  | Agent 不在配置里                                                    | 创建任务、追问、刷新 Agent            |
| `REPO_NOT_FOUND`                  | 404  | 仓库不在配置里                                                      | 创建任务、追问、仓库接口              |
| `TOKEN_NOT_FOUND`                 | 404  | token 不存在                                                        | token 接口                            |
| `DIFF_NOT_AVAILABLE`              | 404  | 还没有可用的快照                                                    | diff                                  |
| `AGENT_DISABLED`                  | 409  | Agent 在配置里被禁用                                                | 创建任务、追问                        |
| `TASK_BUSY`                       | 409  | 任务不在终态                                                        | 追问、归档、应用                      |
| `TASK_ARCHIVED`                   | 409  | 已归档的任务不能追问                                                | 追问                                  |
| `TASK_NOT_ARCHIVED`               | 409  | 删除前必须先归档                                                    | 删除任务                              |
| `WORKSPACE_REMOVED`               | 409  | worktree 已被保留策略移除，不能追问                                 | 追问                                  |
| `ILLEGAL_TRANSITION`              | 409  | 当前状态或任务类型不允许该操作                                      | 网页任务接口、改已吊销 token 的 scope |
| `APPROVAL_NOT_PENDING`            | 409  | 审批已经结束                                                        | 审批决定                              |
| `IDEMPOTENCY_CONFLICT`            | 409  | 同一幂等键、不同请求                                                | 创建任务、追问                        |
| `WORKSPACE_DIRTY`                 | 409  | 合并时原仓库有未提交的改动                                          | 应用                                  |
| `MERGE_CONFLICT`                  | 409  | 合并冲突，或远端分支不能快进                                        | 应用                                  |
| `GIT_IDENTITY_MISSING`            | 409  | 缺少 `user.name` / `user.email`                                     | 应用                                  |
| `NOTHING_TO_APPLY`                | 409  | 任务分支相对基线没有任何改动                                        | 应用                                  |
| `APPLY_NOT_SUPPORTED`             | 409  | 原目录任务不提供“应用”                                              | 应用                                  |
| `PAYLOAD_TOO_LARGE`               | 413  | 请求体超过 1 MB                                                     | 全部                                  |
| `RATE_LIMITED`                    | 429  | 桥接 token 超过速率、并发 `wait` 或 WebSocket 连接上限              | 全部                                  |
| `INTERNAL`                        | 500  | 未预期的错误（`details.requestId`）                                 | 全部                                  |
| `QUEUE_FULL`                      | 503  | 排队已满                                                            | 创建任务、追问                        |
| `SHUTTING_DOWN`                   | 503  | 侧车正在停机                                                        | 全部                                  |

## 8. 本地郎接入示例

本地郎是本机进程，读 `bridge-token` 文件拿 token（每次请求都读：设置页轮换默认 token 后不用重启本地郎）。推荐流程：创建任务（带幂等键）→ `wait?until=turn_end` 循环 → 取 `result` → 需要时取 diff → 追问。等待期间 `pendingApprovals > 0` 时提醒用户去 Hub 里审批（默认 token 不能审批，D44）。

### 8.1 shell

```bash
HUB=http://127.0.0.1:47821/api/v1
auth() { printf 'Authorization: Bearer %s' "$(cat "$HOME/Library/Application Support/AgentHub/bridge-token")"; }

# 1. 派发只读任务（不传 repoId 就用默认仓库）
TASK=$(curl -sS -H "$(auth)" -H 'Content-Type: application/json' -H 'Idempotency-Key: conv_7f3a:msg_12' \
  -d '{"agentId":"codex","prompt":"列出 apps 下的所有子项目及其技术栈","externalRef":"conv_7f3a"}' \
  "$HUB/tasks" | jq -r .task.id)

# 2. 等本轮结束（每次最多 60 秒）
while :; do
  r=$(curl -sS --max-time 75 -H "$(auth)" "$HUB/tasks/$TASK/wait?until=turn_end&timeoutSec=60") || { sleep 2; continue; }
  [ "$(jq -r .reached <<<"$r")" = true ] && break
  [ "$(jq -r .task.pendingApprovals <<<"$r")" -gt 0 ] && echo '有待审批的请求，请在 Agent Hub 里处理'
done

# 3. 结果与改动
curl -sS -H "$(auth)" "$HUB/tasks/$TASK/result" | jq '{status, final: .turn.finalMessage, files: .diff.stats.filesChanged}'
curl -sS -D - -H "$(auth)" "$HUB/tasks/$TASK/diff?format=patch"

# 4. 追问
curl -sS -H "$(auth)" -H 'Content-Type: application/json' -H 'Idempotency-Key: conv_7f3a:msg_13' \
  -d '{"prompt":"再给出每个子项目的测试命令"}' "$HUB/tasks/$TASK/turns" | jq .turn.index
```

### 8.2 Node（内置 `fetch`）

```ts
// 本地郎侧示例：Node 22+，只用内置 fetch。类型可以从 @agent-hub/contract 引用，也可以照抄。
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type {
  ApiErrorBody,
  CreateTaskBody,
  FollowUpBody,
  TaskResultDto,
  TaskWithTurnResponse,
  WaitResponse,
} from '@agent-hub/contract';

const BASE = 'http://127.0.0.1:47821/api/v1';
const TOKEN_FILE = join(homedir(), 'Library/Application Support/AgentHub/bridge-token');

export class HubError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  // 每次读文件：设置页轮换默认 token 后不用重启本地郎。
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(75_000),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new HubError(
      res.status,
      err?.error.code ?? `HTTP_${res.status}`,
      err?.error.message ?? res.statusText,
    );
  }
  return (await res.json()) as T;
}

/** Hub 重启、网络抖动时重试；业务错误（4xx）直接抛出。 */
async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const transient = !(err instanceof HubError) || err.status === 429 || err.status === 503;
      if (!transient || attempt >= 5) throw err;
      await sleep(2000 * attempt);
    }
  }
}

async function waitTurnEnd(taskId: string, onApproval?: (pending: number) => void): Promise<void> {
  for (;;) {
    const w = await retrying(() =>
      call<WaitResponse>('GET', `/tasks/${taskId}/wait?until=turn_end&timeoutSec=60`),
    );
    if (w.reached) return;
    if (w.task.pendingApprovals > 0) onApproval?.(w.task.pendingApprovals);
  }
}

/** 派发并等到本轮结束。key 用“对话 id:消息 id”，整函数重试也不会重复派发。 */
export async function runTask(
  body: CreateTaskBody,
  key: string,
  onApproval?: (pending: number) => void,
): Promise<TaskResultDto> {
  const { task } = await retrying(() => call<TaskWithTurnResponse>('POST', '/tasks', body, key));
  await waitTurnEnd(task.id, onApproval);
  return retrying(() => call<TaskResultDto>('GET', `/tasks/${task.id}/result`));
}

export async function followUp(
  taskId: string,
  body: FollowUpBody,
  key: string,
  onApproval?: (pending: number) => void,
): Promise<TaskResultDto> {
  await retrying(() => call<TaskWithTurnResponse>('POST', `/tasks/${taskId}/turns`, body, key));
  await waitTurnEnd(taskId, onApproval);
  return retrying(() => call<TaskResultDto>('GET', `/tasks/${taskId}/result`));
}

/** 整个任务的补丁文本（最多 512 KB，按文件截断）。 */
export async function getPatch(taskId: string): Promise<{ patch: string; truncated: boolean }> {
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  const res = await fetch(`${BASE}/tasks/${taskId}/diff?format=patch`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new HubError(
      res.status,
      err?.error.code ?? `HTTP_${res.status}`,
      err?.error.message ?? res.statusText,
    );
  }
  return {
    patch: await res.text(),
    truncated: res.headers.get('x-agent-hub-truncated') === 'true',
  };
}

export async function cancel(taskId: string, force = false): Promise<void> {
  await retrying(() => call('POST', `/tasks/${taskId}/cancel`, { force }));
}
```

### 8.3 Node（WebSocket，可选）

```ts
// 可选：用 WebSocket 实时跟踪一个任务（npm 包 ws）。断线后带最后的 seq 重连，不丢事件。
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { HubEvent, WsClientMessage, WsServerMessage } from '@agent-hub/contract';

const TOKEN_FILE = join(homedir(), 'Library/Application Support/AgentHub/bridge-token');

export function follow(taskId: string, onEvent: (event: HubEvent) => void): () => void {
  let lastSeq = 0;
  let stopped = false;
  let ws: WebSocket | null = null;

  const connect = (): void => {
    const token = readFileSync(TOKEN_FILE, 'utf8').trim();
    const socket = new WebSocket('ws://127.0.0.1:47821/api/v1/ws', {
      headers: { Authorization: `Bearer ${token}` },
    });
    ws = socket;
    const send = (msg: WsClientMessage): void => socket.send(JSON.stringify(msg));
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as WsServerMessage;
      if (msg.op === 'ready') {
        send({ op: 'subscribe', id: 'follow', topic: 'task', taskId, afterSeq: lastSeq });
      } else if (msg.op === 'event') {
        lastSeq = msg.seq;
        onEvent(msg.event);
      } else if (msg.op === 'error') {
        console.error(`订阅失败：${msg.code} ${msg.message}`);
      }
    });
    socket.on('close', (code) => {
      ws = null;
      // 4401 / 4403：token 失效或没有权限，重连也没用。
      if (!stopped && code !== 4401 && code !== 4403) setTimeout(connect, 2000);
    });
    socket.on('error', () => undefined);
  };

  connect();
  return () => {
    stopped = true;
    ws?.close(1000);
  };
}
```
