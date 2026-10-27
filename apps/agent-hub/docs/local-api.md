# 本地 API 契约

> 上级文档：[../README.md](../README.md)。侧车只监听 `127.0.0.1:47821`（端口可配置），对外有两套接口，背后是同一组服务：
>
> | 接口                      | 调用方             | 形式                                     |
> | ------------------------- | ------------------ | ---------------------------------------- |
> | `/trpc`、`/trpc-ws`       | Hub UI             | tRPC v11：HTTP 批量请求 + WebSocket 订阅 |
> | `/api/v1/*`、`/api/v1/ws` | 桥接方（本地郎）等 | REST + WebSocket，本文定义的稳定契约     |
>
> `/api/v1` 只做向后兼容的增量修改（加字段、加接口、加事件类型）；破坏性修改开 `/api/v2`。客户端必须忽略不认识的字段和事件类型。

## 1. 鉴权

### 1.1 网络层检查（所有请求，含 WebSocket 握手）

| 检查        | 规则                                                                                                                                                                     | 失败                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 监听地址    | 只绑定 `127.0.0.1`；配置成其他地址时启动失败                                                                                                                             | —                        |
| `Host` 头   | 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`（防 DNS rebinding）                                                                                                      | `421 HOST_NOT_ALLOWED`   |
| `Origin` 头 | 没有 `Origin` 的请求（命令行、Node 客户端）放行到下一步；有 `Origin` 时必须在白名单里：`tauri://localhost`、`http://tauri.localhost`，开发模式加 `http://localhost:5174` | `403 ORIGIN_NOT_ALLOWED` |
| CORS        | 只对白名单 origin 回 `Access-Control-Allow-Origin`，不用通配，不用 Cookie                                                                                                | —                        |
| 限流        | 每个 token 每秒 50 个请求（防止 Bot 死循环）                                                                                                                             | `429 RATE_LIMITED`       |

### 1.2 token

- 一律 `Authorization: Bearer <token>`。比较用常量时间比较；库里只存 SHA-256。
- token 格式：`ahb_` 前缀 + 32 字节随机数的 base64url（前缀便于密钥扫描工具识别）。
- 两类主体：

| 主体       | token 来源                                                                                                                               | 权限                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Hub UI     | 每次启动由 Tauri 生成，经 stdin 交给侧车，经 IPC 交给 Hub UI（desktop-shell.md §4.2），只在内存里                                        | 全部，含设置与 token 管理 |
| 桥接客户端 | 设置页创建，可多个、可吊销。首次启动自动创建一个名为“本地郎”的默认 token，明文写入 `<AGENT_HUB_HOME>/bridge-token`（`0600`）供本地郎读取 | 按 scope                  |

### 1.3 scope

| scope              | 允许                                                      | 默认 token 是否带 |
| ------------------ | --------------------------------------------------------- | ----------------- |
| `tasks:read`       | 任务列表、详情、事件、结果；Agent 与仓库列表              | 是                |
| `tasks:create`     | 创建只读任务；对**自己创建的**任务追问、取消、归档        | 是                |
| `tasks:write_mode` | 创建可写任务（默认仍需人在界面确认，见 security.md §4.3） | 是                |
| `diff:read`        | 读取 diff 补丁                                            | 是                |
| `approvals:read`   | 查看审批请求                                              | 是                |
| `approvals:decide` | 审批                                                      | **否**            |
| `tasks:manage_all` | 对别人（含界面）创建的任务追问、取消                      | **否**            |

缺少 scope → `403 FORBIDDEN_SCOPE`；操作别人的任务且没有 `tasks:manage_all` → `403 TASK_NOT_OWNED`。

## 2. 通用约定

- 请求、响应都是 UTF-8 JSON；时间是 ISO 8601（UTC，带 `Z`）；id 是 ULID 字符串。
- 列表接口用游标分页：`?limit=50&cursor=<上次的 nextCursor>`，`limit` 最大 200。
- `POST /api/v1/tasks` 与 `POST /api/v1/tasks/:id/turns` 支持 `Idempotency-Key` 请求头（24 小时内有效）：同一 token、同一键、同样的请求体返回第一次的结果；请求体不同返回 `409 IDEMPOTENCY_CONFLICT`。**桥接方应当总是带上**，避免网络重试造成重复派发。
- 请求体上限 1 MB，其中提示词上限 200 KB → `413 PAYLOAD_TOO_LARGE`。
- 返回给桥接方的所有文本（消息、工具输出、diff）都经过与日志相同的密钥脱敏（security.md §5）。
- `security.bridgeSummaryOnly` 为 `true` 时（默认 `false`，见待决问题 Q6），桥接方拿到的事件里去掉 `reasoning.*`、`tool.output` 与 `diff.reported` 的补丁，结果接口只返回最后一条 Agent 消息和 diff 统计，补丁接口返回 `403 FORBIDDEN_SCOPE`。Hub UI 不受影响。

错误响应：

```json
{
  "error": {
    "code": "TASK_BUSY",
    "message": "任务正在运行，不能追问",
    "details": { "status": "running" }
  }
}
```

## 3. 资源

```ts
// contract/src/api.ts（节选）
import type {
  AdapterKind,
  ApprovalDecision,
  ApprovalKind,
  ApprovalStatus,
  DecidedBy,
  DiffStats,
  StopReason,
  TaskMode,
  TaskSource,
  TaskStatus,
  TurnStatus,
  UsageInfo,
  WorkspaceMode,
} from './domain';
import type { AgentError } from './errors';
import type { AgentCapabilities, AgentHealth } from './capabilities';
import type { ApprovalRequest } from './events';

export interface TaskDto {
  id: string;
  shortId: string;
  title: string;
  agentId: string;
  agentName: string;
  adapterKind: AdapterKind;
  model: string | null;
  reasoningEffort: string | null;
  agentMode: string | null;
  mode: TaskMode;
  workspaceMode: WorkspaceMode;
  status: TaskStatus;
  source: TaskSource;
  /** 桥接方自己的关联标识（例如对话 id），原样返回。 */
  externalRef: string | null;
  externalUrl: string | null;
  repoId: string | null;
  cwd: string;
  branch: string | null;
  baseCommit: string | null;
  userVisible: boolean;
  readOnlyViolation: boolean;
  pendingApprovals: number;
  turnCount: number;
  lastEventSeq: number;
  lastError: AgentError | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  archivedAt: string | null;
}

export interface TurnDto {
  id: string;
  index: number;
  prompt: string;
  status: TurnStatus;
  stopReason: StopReason | null;
  finalMessage: string | null;
  usage: UsageInfo | null;
  error: AgentError | null;
  startedAt: string;
  completedAt: string | null;
}

export interface TaskDetailDto extends TaskDto {
  turns: TurnDto[];
  approvals: ApprovalDto[];
}

export interface ApprovalDto {
  id: string;
  taskId: string;
  turnId: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  request: ApprovalRequest;
  decision: ApprovalDecision | null;
  decidedBy: DecidedBy | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface TaskResultDto {
  taskId: string;
  status: TaskStatus;
  /** 最近一轮。 */
  turnIndex: number;
  stopReason: StopReason | null;
  /** 最近一轮 Agent 的最后一条消息。 */
  summary: string | null;
  diff: { snapshotId: string; stats: DiffStats; patchBytes: number; truncated: boolean } | null;
  usage: UsageInfo | null;
  error: AgentError | null;
  finishedAt: string | null;
}

export interface AgentDto {
  id: string;
  displayName: string;
  kind: AdapterKind;
  enabled: boolean;
  health: AgentHealth;
  capabilities: AgentCapabilities | null;
  maxConcurrent: number;
  running: number;
}

export interface CreateTaskRequest {
  agentId: string;
  prompt: string;
  /** 默认取提示词前 40 个字。 */
  title?: string;
  /** repoId 与 cwd 至少给一个；cwd 必须位于某个已注册仓库之内。 */
  repoId?: string;
  cwd?: string;
  /** 默认 read_only。 */
  mode?: TaskMode;
  /** 默认按 mode 与 Agent 类型推断（architecture.md §6.1）。 */
  workspace?: WorkspaceMode;
  /** 默认 HEAD。 */
  baseRef?: string;
  model?: string;
  reasoningEffort?: string;
  agentMode?: string;
  /** 仅 Codex：会话是否也出现在 ChatGPT 应用里。默认：版本支持时为 true，否则 false（待决问题 Q5）。 */
  userVisible?: boolean;
  externalRef?: string;
  externalUrl?: string;
}
```

## 4. 接口一览

| 方法与路径                            | scope                                             | 说明                                                                                     |
| ------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /healthz`                        | 无需鉴权                                          | 只返回 `{"ok":true}`，供探测 Hub 是否在运行                                              |
| `GET /api/v1/health`                  | `tasks:read`                                      | 侧车版本、各 Agent 健康状态、是否暂停接收桥接任务                                        |
| `GET /api/v1/agents`                  | `tasks:read`                                      | `AgentDto[]`                                                                             |
| `GET /api/v1/agents/:agentId/models`  | `tasks:read`                                      | 模型与推理档位；`?refresh=true` 强制刷新                                                 |
| `GET /api/v1/repos`                   | `tasks:read`                                      | 已注册仓库（id、路径、默认基线、体检结果）                                               |
| `POST /api/v1/tasks`                  | `tasks:create`（可写任务另需 `tasks:write_mode`） | 创建任务，返回 `202 { task: TaskDto }`                                                   |
| `GET /api/v1/tasks`                   | `tasks:read`                                      | 筛选：`status`、`agentId`、`source`、`repoId`、`externalRef`、`archived`；按创建时间倒序 |
| `GET /api/v1/tasks/:id`               | `tasks:read`                                      | `TaskDetailDto`                                                                          |
| `GET /api/v1/tasks/:id/events`        | `tasks:read`                                      | `?afterSeq=0&limit=500`，返回 `{ events: HubEventEnvelope[], nextSeq, hasMore }`         |
| `GET /api/v1/tasks/:id/wait`          | `tasks:read`                                      | 长轮询，见 §5.2                                                                          |
| `GET /api/v1/tasks/:id/result`        | `tasks:read`                                      | `TaskResultDto`                                                                          |
| `GET /api/v1/tasks/:id/diff`          | `diff:read`                                       | `?turn=<index>`（默认最近一轮）`&format=patch \| json`，见 §5.3                          |
| `POST /api/v1/tasks/:id/turns`        | `tasks:create`                                    | 追问：`{ prompt }`，返回 `202 { task, turn }`                                            |
| `POST /api/v1/tasks/:id/cancel`       | `tasks:create`                                    | `{ force?: boolean }`：默认停止本轮，`force` 为强制结束                                  |
| `POST /api/v1/tasks/:id/archive`      | `tasks:create`                                    | 归档（运行中不可归档）                                                                   |
| `GET /api/v1/approvals`               | `approvals:read`                                  | `?status=pending&taskId=`                                                                |
| `POST /api/v1/approvals/:id/decision` | `approvals:decide`                                | `{ decision: ApprovalDecision, note?: string }`                                          |
| `GET /api/v1/ws`                      | `tasks:read`                                      | WebSocket 订阅，见 §6                                                                    |

## 5. 关键接口细节

### 5.1 创建任务

请求示例：

```json
{
  "agentId": "codex",
  "repoId": "multi-apps",
  "prompt": "分析 apps/cardhub/api 冷启动慢的原因，只读，不要改文件。",
  "reasoningEffort": "high",
  "externalRef": "conv_7f3a/msg_12"
}
```

校验顺序与错误：

1. Agent 存在 → 否则 `404 AGENT_NOT_FOUND`；已启用 → 否则 `409 AGENT_DISABLED`；健康状态不是 `unavailable` → 否则 `409 AGENT_UNAVAILABLE`；不是 `auth_required` → 否则 `409 AGENT_AUTH_REQUIRED`（提示去登录）。
2. `repoId` 已注册 → 否则 `400 REPO_NOT_REGISTERED`；`cwd`（若给）`realpath` 后位于某个已注册仓库之内 → 否则 `400 PATH_NOT_ALLOWED`（桥接方不能让 Agent 去任意目录）。
3. `mode: "write"` 需要 `tasks:write_mode` → 否则 `403 FORBIDDEN_SCOPE`；配置关闭了桥接写任务 → `403 WRITE_MODE_DISABLED`。
4. 模型列表已知时，`model` / `reasoningEffort` 必须在列表里 → 否则 `400 MODEL_NOT_SUPPORTED`；列表未知（`modelsSource: 'session'`）时放行，由 Agent 决定。
5. 排队已满 → `503 QUEUE_FULL`；菜单栏里暂停了桥接任务 → `503 BRIDGE_PAUSED`。

成功返回 `202`，`task.status` 为 `queued`，桥接方创建的写任务在需要确认时为 `pending_confirmation`。

### 5.2 长轮询 `wait`

给不方便维持 WebSocket 的调用方（例如以“工具调用”方式工作的聊天 Bot）：

`GET /api/v1/tasks/:id/wait?until=turn_end&afterSeq=<seq>&timeoutMs=50000`

- `until`：`turn_end`（本轮结束：`completed` / `failed` / `cancelled` / `interrupted`）、`approval`（出现待审批）、`any`（有任何新事件）。
- `timeoutMs` 最大 55000。满足条件立即返回 `{ reached: true, task, events }`；超时返回 `{ reached: false, task, events }`（`events` 为 `afterSeq` 之后的新事件，最多 200 条），调用方带上新的 `afterSeq` 再来。

### 5.3 diff

- `format=json`：`{ snapshotId, turnIndex, baseCommit, headCommit, stats: DiffStats, truncated }`。
- `format=patch`：`Content-Type: text/x-diff; charset=utf-8`，统一 diff 文本。
- 返回给桥接方的补丁按文件边界截断到 `security.maxBridgeDiffBytes`（默认 512 KB），被截断时响应头 `X-Agent-Hub-Truncated: true`，JSON 里 `truncated: true`。Hub UI 不受这个限制。
- 还没有快照（第一轮未结束）→ `404 DIFF_NOT_AVAILABLE`。

## 6. WebSocket `/api/v1/ws`

### 6.1 连接与鉴权

- 握手时带 `Authorization: Bearer <token>`。不能设置请求头的客户端：连接后 5 秒内发送第一条消息 `{"op":"auth","token":"..."}`，否则以 `4401` 关闭。
- 服务端每 20 秒发 WebSocket ping 帧，60 秒收不到 pong 就断开。

### 6.2 消息

客户端 → 服务端：

```json
{ "op": "subscribe", "id": "s1", "topics": ["tasks", "approvals"] }
{ "op": "subscribe", "id": "s2", "topics": ["task:01JC8Z7Q4M2W6X3Y9V5T0R1S2P"], "afterSeq": 120 }
{ "op": "unsubscribe", "id": "s3", "topics": ["approvals"] }
{ "op": "ping" }
```

服务端 → 客户端：

| `type`       | 内容                                                                      | 触发                                 |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------ |
| `subscribed` | `{ id, topics }`                                                          | 订阅成功                             |
| `event`      | `HubEventEnvelope` 的全部字段（`taskId`、`seq`、`turnId`、`ts`、`event`） | 订阅了 `task:<id>`                   |
| `task`       | `{ task: TaskDto }`                                                       | 订阅了 `tasks`，任务状态或计数变化   |
| `approval`   | `{ approval: ApprovalDto }`                                               | 订阅了 `approvals`，新建或状态变化   |
| `pong`       | `{}`                                                                      | 回应 `ping`                          |
| `error`      | `{ id?, code, message }`                                                  | 订阅失败（如任务不存在、scope 不足） |

### 6.3 顺序与续订

- 同一任务的 `event` 按 `seq` 严格递增，不重不漏。
- 带 `afterSeq` 订阅时，服务端先订阅实时总线并缓冲，再从库里回放 `seq > afterSeq` 的事件，回放完再输出缓冲中 `seq` 更大的部分，保证衔接处没有空洞和重复。
- 断线后，客户端用最后收到的 `seq` 重新订阅即可。
- 实时流和库里存的是同一份合并后的事件（architecture.md §5），回放与实时看到的内容一致。

### 6.4 关闭码

| 关闭码 | 含义                                                        |
| ------ | ----------------------------------------------------------- |
| `1001` | 侧车停机                                                    |
| `4400` | 消息格式错误                                                |
| `4401` | 未鉴权或 token 无效 / 已吊销                                |
| `4403` | 无权订阅                                                    |
| `4008` | 消费太慢（待发送缓冲超过 8 MB），客户端应带 `afterSeq` 重连 |

## 7. 错误码

| code                        | HTTP | 含义                                               |
| --------------------------- | ---- | -------------------------------------------------- |
| `UNAUTHORIZED`              | 401  | 没有 token、token 无效或已吊销                     |
| `FORBIDDEN_SCOPE`           | 403  | 缺少所需 scope                                     |
| `TASK_NOT_OWNED`            | 403  | 操作别人创建的任务                                 |
| `ORIGIN_NOT_ALLOWED`        | 403  | `Origin` 不在白名单                                |
| `WRITE_MODE_DISABLED`       | 403  | 配置禁止桥接方创建可写任务                         |
| `HOST_NOT_ALLOWED`          | 421  | `Host` 头不是本机回环地址                          |
| `VALIDATION_FAILED`         | 400  | 请求体不符合 schema，`details` 里是 zod 的问题列表 |
| `REPO_NOT_REGISTERED`       | 400  | 仓库未注册                                         |
| `PATH_NOT_ALLOWED`          | 400  | `cwd` 不在已注册仓库之内                           |
| `MODEL_NOT_SUPPORTED`       | 400  | 模型或推理档位不在该 Agent 的列表里                |
| `TASK_NOT_FOUND`            | 404  | —                                                  |
| `APPROVAL_NOT_FOUND`        | 404  | —                                                  |
| `AGENT_NOT_FOUND`           | 404  | —                                                  |
| `DIFF_NOT_AVAILABLE`        | 404  | 还没有 diff 快照                                   |
| `AGENT_DISABLED`            | 409  | Agent 在配置里被禁用                               |
| `AGENT_UNAVAILABLE`         | 409  | 找不到可执行文件、版本不支持等                     |
| `AGENT_AUTH_REQUIRED`       | 409  | Agent 未登录                                       |
| `TASK_BUSY`                 | 409  | 任务有进行中的轮                                   |
| `TASK_NOT_RESUMABLE`        | 409  | 原生会话无法恢复                                   |
| `ILLEGAL_TRANSITION`        | 409  | 当前状态不允许该操作（如归档运行中的任务）         |
| `APPROVAL_ALREADY_RESOLVED` | 409  | 审批已有决定                                       |
| `IDEMPOTENCY_CONFLICT`      | 409  | 同一幂等键、不同请求体                             |
| `PAYLOAD_TOO_LARGE`         | 413  | —                                                  |
| `RATE_LIMITED`              | 429  | —                                                  |
| `QUEUE_FULL`                | 503  | 排队已满                                           |
| `BRIDGE_PAUSED`             | 503  | 用户暂停了桥接任务                                 |
| `INTERNAL`                  | 500  | 未预期错误（日志里有关联 id）                      |

## 8. 接入示例（给本地郎）

创建任务并等待结果（shell）：

```bash
TOKEN="$(cat "$HOME/Library/Application Support/AgentHub/bridge-token")"
BASE=http://127.0.0.1:47821/api/v1

TASK_ID=$(curl -sf "$BASE/tasks" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: conv_7f3a-msg_12" \
  -d '{"agentId":"codex","repoId":"multi-apps","prompt":"列出 apps 下的所有子项目及其技术栈"}' | jq -r .task.id)

curl -sf "$BASE/tasks/$TASK_ID/wait?until=turn_end&timeoutMs=50000" -H "Authorization: Bearer $TOKEN" | jq .reached
curl -sf "$BASE/tasks/$TASK_ID/result" -H "Authorization: Bearer $TOKEN" | jq '{status, summary, diff: .diff.stats}'
```

订阅实时事件（Node，`ws` 包）：

```ts
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const token = readFileSync(
  join(homedir(), 'Library/Application Support/AgentHub/bridge-token'),
  'utf8',
).trim();

export function follow(taskId: string, onDone: () => void) {
  let lastSeq = 0;
  const connect = () => {
    const ws = new WebSocket('ws://127.0.0.1:47821/api/v1/ws', {
      headers: { Authorization: `Bearer ${token}` },
    });
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          id: 's1',
          topics: [`task:${taskId}`],
          afterSeq: lastSeq,
        }),
      );
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as {
        type: string;
        seq?: number;
        event?: { type: string };
      };
      if (msg.type !== 'event' || msg.seq === undefined) return;
      lastSeq = msg.seq;
      if (msg.event?.type === 'turn.completed') {
        ws.close();
        onDone();
      }
    });
    ws.on('close', (code) => {
      if (code === 4008 || code === 1006) setTimeout(connect, 1000);
    });
  };
  connect();
}
```

## 9. 可选：MCP 端点（M5）

如果本地郎能以 MCP 客户端方式接工具，侧车可以在 `/mcp` 提供 Streamable HTTP 的 MCP 服务器，鉴权与 scope 和 REST 完全一样，工具与 REST 一一对应：`agent_hub_list_agents`、`agent_hub_create_task`、`agent_hub_get_task`、`agent_hub_wait_task`（即 §5.2）、`agent_hub_get_result`、`agent_hub_get_diff`、`agent_hub_follow_up`、`agent_hub_cancel_task`。是否做取决于本地郎的实现方式（待决问题 Q3）。

## 10. Hub UI 的 tRPC router（概要）

| router      | 过程                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `agents`    | `list`、`models`、`refresh`                                                                                                         |
| `repos`     | `list`、`check`                                                                                                                     |
| `tasks`     | `list`、`get`、`events`、`diff`、`create`、`confirmWrite`、`rejectWrite`、`followUp`、`cancel`、`archive`、`delete`、`applyToLocal` |
| `approvals` | `list`、`decide`                                                                                                                    |
| `settings`  | `get`、`update`、`exportDiagnostics`                                                                                                |
| `tokens`    | `list`、`create`（明文只在返回值里出现一次）、`revoke`                                                                              |
| `live`      | 订阅：`tasks`、`task`（`{ taskId, afterSeq }`）、`approvals`                                                                        |

- 查询与变更走 `httpBatchLink`（`Authorization` 头带 UI token），订阅走 `wsLink`（`connectionParams` 里带 UI token，服务端在 `createContext` 里校验）。
- 输入 schema 与 REST 共用 contract 里的 zod schema；错误用 `TRPCError`，`cause.code` 与 §7 的错误码一致。
