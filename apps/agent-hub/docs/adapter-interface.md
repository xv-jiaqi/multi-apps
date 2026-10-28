# 适配器接口

> 上级文档：[../README.md](../README.md)。本文是所有适配器共同遵守的契约：领域类型、统一事件、错误码、审批流程、适配器运行时接口、JSON-RPC 行传输、子进程管理、能力与健康。各协议的映射见 [adapter-codex.md](adapter-codex.md)、[adapter-acp.md](adapter-acp.md)、[web-agent.md](web-agent.md)。
>
> 本文的 TS 代码块都是**完整文件**（首行注释是文件路径），已在 TypeScript 6 + Node 22 下编译通过；`connection.ts`、`supervisor.ts` 已用真实子进程跑过 §7.3、§8.5 列出的场景。实现时**原样复制**，要改语义先改本文。

## 1. 文件与放置位置

| 文件                                        | 包                    | 全文在                                | 用途                                       |
| ------------------------------------------- | --------------------- | ------------------------------------- | ------------------------------------------ |
| `contract/src/domain.ts`                    | `@agent-hub/contract` | §2                                    | 枚举与基础数据类型                         |
| `contract/src/events.ts`                    | `@agent-hub/contract` | §3                                    | 统一事件与信封                             |
| `contract/src/errors.ts`                    | `@agent-hub/contract` | §4                                    | `AgentErrorCode`、`ApiErrorCode`           |
| `contract/src/capabilities.ts`              | `@agent-hub/contract` | §9                                    | 能力、模型、健康                           |
| `contract/src/dto.ts`、`api.ts`             | `@agent-hub/contract` | [local-api.md](local-api.md) §4       | DTO、请求 schema、WS 消息                  |
| `contract/src/config.ts`                    | `@agent-hub/contract` | [architecture.md](architecture.md) §8 | `config.json` schema                       |
| `contract/src/labels.ts`                    | `@agent-hub/contract` | [hub-ui.md](hub-ui.md) §2             | 中文标签（含 `reasoningEffortLabel`）      |
| `server/src/adapters/types.ts`              | `@agent-hub/server`   | §6                                    | 适配器运行时接口（依赖 Node 流，只在侧车） |
| `server/src/adapters/jsonrpc/connection.ts` | `@agent-hub/server`   | §7                                    | Codex 与 ACP 共用的 JSON-RPC 行传输        |
| `server/src/adapters/process/supervisor.ts` | `@agent-hub/server`   | §8                                    | 登录 PATH、进程组启动与结束、残留清理      |
| `server/src/adapters/registry.ts`           | `@agent-hub/server`   | §9.2（按规则实现）                    | 实例化适配器、健康与能力缓存               |
| `server/src/adapters/codex/*`               | `@agent-hub/server`   | [adapter-codex.md](adapter-codex.md)  | Codex 适配器                               |
| `server/src/adapters/acp/*`                 | `@agent-hub/server`   | [adapter-acp.md](adapter-acp.md)      | 通用 ACP 适配器与 profile                  |
| `server/src/adapters/web/*`                 | `@agent-hub/server`   | [web-agent.md](web-agent.md)          | 网页 Agent（人工协作）                     |

- contract 里的 `domain.ts`、`events.ts`、`errors.ts`、`capabilities.ts` **只有类型和常量数组**，没有 zod schema：事件与能力只由侧车产出，不需要运行时校验。常量数组用于 zod 枚举（`z.enum(TASK_MODES)`）、DDL 的 `CHECK` 和测试穷举。
- 侧车内部一律相对路径导入（D57）；contract 的导入写 `from '@agent-hub/contract'`。

## 2. 领域类型

```ts
// contract/src/domain.ts
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const ADAPTER_KINDS = ['codex', 'acp', 'web'] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export const TASK_MODES = ['read_only', 'write'] as const;
export type TaskMode = (typeof TASK_MODES)[number];

export const WORKSPACE_KINDS = ['in_place', 'worktree', 'remote_branch'] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const TASK_SOURCES = ['ui', 'bridge'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const TASK_STATUSES = [
  'queued',
  'preparing',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const satisfies readonly TaskStatus[];
export type TerminalTaskStatus = (typeof TERMINAL_TASK_STATUSES)[number];

export function isTerminalStatus(status: TaskStatus): status is TerminalTaskStatus {
  return (TERMINAL_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}

export const TURN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

/** 归一后的轮结束原因；各协议的映射见适配器分册。 */
export const STOP_REASONS = [
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
  'error',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export const APPROVAL_KINDS = ['command', 'file_change', 'network', 'other'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/** Hub 只提供这四种决定；会写进 Agent 持久配置的选项（“永久允许”等）不暴露。 */
export const APPROVAL_DECISIONS = [
  'allow_once',
  'allow_for_session',
  'reject',
  'cancel_turn',
] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'withdrawn',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const DECIDERS = ['ui', 'bridge', 'system'] as const;
export type DecidedBy = (typeof DECIDERS)[number];

export const TOOL_KINDS = [
  'command',
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'fetch',
  'think',
  'mcp',
  'other',
] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const SCOPES = ['tasks:read', 'tasks:write', 'approvals:decide'] as const;
export type Scope = (typeof SCOPES)[number];

export interface PlanEntry {
  step: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface UsageInfo {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  /** 模型上下文窗口大小（token）。 */
  contextWindow?: number;
}

export interface DiffFileStat {
  path: string;
  /** 只有改名时有值。 */
  oldPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  insertions: number;
  deletions: number;
  binary: boolean;
}

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: DiffFileStat[];
}
```

- `TaskStatus`、`TurnStatus` 的含义与迁移规则见 [architecture.md](architecture.md) §3。
- `ApprovalDecision` 只有四个值。会改写 Agent 持久配置的选项（Codex 的 execpolicy / 网络策略 amendment，ACP 的 `allow_always` / `reject_always`）**不提供**，Hub 也不做自动批准（唯一的例外是只读 ACP 任务里代为拒绝“退出计划模式”，[adapter-acp.md](adapter-acp.md) §7.3）。
- `DecidedBy`：`ui` = Hub 界面，`bridge` = 桥接 token，`system` = 超时、撤回、停机、重启时由 Hub 结束。

## 3. 统一事件

```ts
// contract/src/events.ts
import type {
  ApprovalDecision,
  ApprovalStatus,
  DecidedBy,
  DiffStats,
  PlanEntry,
  StopReason,
  TaskStatus,
  ToolKind,
  TurnStatus,
  UsageInfo,
} from './domain';
import type { ApprovalDto } from './dto';
import type { AgentError } from './errors';

/** 适配器产出的事件（经 AgentEventSink.emit）。 */
export type AgentEvent =
  | { type: 'session.started'; nativeSessionId: string; model: string | null; resumed: boolean }
  | { type: 'message.delta'; itemId: string; text: string }
  | { type: 'message.completed'; itemId: string; text: string }
  | { type: 'reasoning.delta'; itemId: string; text: string }
  | { type: 'reasoning.completed'; itemId: string; text: string }
  | { type: 'plan.updated'; entries: PlanEntry[]; explanation: string | null }
  | {
      type: 'tool.started';
      itemId: string;
      toolKind: ToolKind;
      /** 一句话中文标题，例如“执行命令”“读取 3 个文件”。 */
      title: string;
      command?: string;
      cwd?: string;
      paths?: string[];
    }
  | { type: 'tool.output.delta'; itemId: string; text: string; truncated?: true }
  | {
      type: 'tool.completed';
      itemId: string;
      status: 'completed' | 'failed' | 'declined';
      exitCode?: number;
      durationMs?: number;
    }
  | { type: 'usage.updated'; usage: UsageInfo }
  /** 网页 Agent：远端任务分支有新提交。 */
  | { type: 'remote.updated'; branch: string; headCommit: string; newCommits: number }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; code?: string; message: string };

/** 核心产出的事件。 */
export type CoreEvent =
  | { type: 'task.status'; from: TaskStatus; to: TaskStatus; reason?: string }
  | {
      type: 'turn.started';
      turnId: string;
      index: number;
      prompt: string;
      model: string | null;
      reasoningEffort: string | null;
    }
  | {
      type: 'turn.completed';
      turnId: string;
      index: number;
      status: TurnStatus;
      stopReason: StopReason;
      error?: AgentError;
    }
  | { type: 'approval.requested'; approval: ApprovalDto }
  | {
      type: 'approval.resolved';
      approvalId: string;
      status: Exclude<ApprovalStatus, 'pending'>;
      decision: ApprovalDecision | null;
      decidedBy: DecidedBy;
    }
  | {
      type: 'diff.updated';
      turnId: string;
      scope: 'turn_end' | 'live';
      task: DiffStats;
      turn: DiffStats;
      patchTruncated: boolean;
    };

export type HubEvent = AgentEvent | CoreEvent;
export type HubEventType = HubEvent['type'];

export const DELTA_EVENT_TYPES = ['message.delta', 'reasoning.delta', 'tool.output.delta'] as const;
export type DeltaEvent = Extract<HubEvent, { type: (typeof DELTA_EVENT_TYPES)[number] }>;

export function isDeltaEvent(event: HubEvent): event is DeltaEvent {
  return (DELTA_EVENT_TYPES as readonly string[]).includes(event.type);
}

export interface HubEventEnvelope {
  taskId: string;
  /** 同一任务内严格递增（可能有空号）。 */
  seq: number;
  /** 所属的轮；任务级事件为 null。 */
  turnId: string | null;
  /** ISO 8601，UTC。 */
  ts: string;
  event: HubEvent;
}
```

### 3.1 约定

1. **谁产出**：`AgentEvent` 只由适配器经 `sink.emit()` 产出；`CoreEvent` 只由核心写入。`sink.emit` 的参数类型就是 `AgentEvent`，适配器写不出核心事件。
2. **`itemId`**：同一任务内唯一（跨轮也不重复）。Codex 用协议的 item id；ACP 的规则见 [adapter-acp.md](adapter-acp.md) §6；网页 Agent 每轮固定两个：`t<轮序号>-handoff`（提示词工具项）与 `t<轮序号>-summary`（本轮总结，[web-agent.md](web-agent.md) §3.2、§3.3）。
3. **顺序**：同一 `itemId` 的事件必须是 `*.started`（只有工具有）→ 若干 `*.delta` → `*.completed`。`message.completed` / `reasoning.completed` 的 `text` 是**完整文本**，以它为准（增量只用于实时显示）。
4. **补齐**：`prompt()` resolve 之前，适配器必须给本轮每个出现过的 item 发出 `*.completed`。协议没有显式“结束”时（ACP 的消息块）由适配器用累计的文本补发；轮结束时还没结束的工具补发 `tool.completed`（`status: 'failed'`）。
5. **`tool.output.delta`**：stdout 与 stderr 不分开；`truncated` 只由核心设置（单个工具 1 MB 上限，[architecture.md](architecture.md) §6），适配器不设。
6. **`usage.updated`**：每次给的是到当前为止的**累计值**，后一条覆盖前一条；核心把本轮最后一条存为轮的 `usage`。
7. **`plan.updated`**：每次给完整的计划列表，覆盖上一份。
8. **`session.started`**：每次 `startSession` 成功恰好一条（新建或恢复，`resumed` 区分）；`model` 是 Agent 报告的当前模型，不知道时为 `null`。
9. **`remote.updated`**：只有网页 Agent 产出（[web-agent.md](web-agent.md) §3）。
10. **不认识的协议通知**：只写 transcript（`sink.raw`）和 `debug` 日志，**不**产出事件、不报错。协议会不断加新通知。
11. **`finalMessage`**：核心取本轮最后一条 `message.completed` 的 `text`。

### 3.2 `notice` 的代码

`notice.code` 是字符串，下表是全部取值；新增时先补这张表。界面按 `level` 着色，按 `code` 决定是否折叠同类提示。

| `code`                   | `level`             | 产出方     | 何时                                                                                                      |
| ------------------------ | ------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| `TURN_LIMIT`             | `warning`           | 核心       | 轮以 `max_tokens` / `max_turn_requests` / `refusal` 结束（§6.1 规则 4）。                                 |
| `READ_ONLY_VIOLATION`    | `error`             | 核心       | 只读任务的工作区在本轮有改动（[architecture.md](architecture.md) §7.3）。                                 |
| `REMOTE_REF_CHANGED`     | `error`             | 核心       | 轮后发现远端跟踪分支有变化（[security.md](security.md) §3.4）。                                           |
| `AGENT_RETRYING`         | `warning`           | Codex      | `error` 通知且 `willRetry: true`（[adapter-codex.md](adapter-codex.md) §5.3）。                           |
| `MODEL_REROUTED`         | `warning`           | Codex      | `model/rerouted`。                                                                                        |
| `CONTEXT_COMPACTED`      | `info`              | Codex、ACP | Codex `contextCompaction` item 结束；ACP `compaction_update` 完成。                                       |
| `USER_INPUT_UNSUPPORTED` | `warning`           | Codex      | `item/tool/requestUserInput`：Hub 回空答案。                                                              |
| `ELICITATION_DECLINED`   | `warning`           | Codex      | `mcpServer/elicitation/request`：Hub 回拒绝。                                                             |
| `AGENT_WARNING`          | `warning` / `error` | Codex、ACP | Agent 自己发的警告（Codex `warning` 通知；ACP `warning` / `error` 级的 `notice`，`info` 级不带 `code`）。 |
| `MODE_RESTORED`          | `warning`           | ACP        | Agent 切到不允许的会话模式，Hub 已切回（D37，[adapter-acp.md](adapter-acp.md) §5）。                      |
| `PLAN_EXIT_DECLINED`     | `info`              | ACP        | 只读任务里 Agent 请求退出计划模式，Hub 代为拒绝、本轮结束（[adapter-acp.md](adapter-acp.md) §7.3）。      |
| `WEB_FETCH_FAILED`       | `warning`           | 网页       | 轮询拉取远端任务分支失败；一段连续失败只发一次（[web-agent.md](web-agent.md) §3.2）。                     |
| `WEB_BRANCH_REWRITTEN`   | `warning`           | 网页       | 远端任务分支被强推改写；每轮只发一次（[web-agent.md](web-agent.md) §3.2）。                               |

## 4. 错误码

```ts
// contract/src/errors.ts
import type { JsonValue } from './domain';

/** 出现在事件、轮和任务的 lastError 里；描述“这一轮为什么失败”。 */
export const AGENT_ERROR_CODES = [
  'AGENT_BINARY_NOT_FOUND',
  'AGENT_SPAWN_FAILED',
  'AGENT_HANDSHAKE_TIMEOUT',
  'AGENT_PROTOCOL_ERROR',
  'AGENT_PROCESS_EXITED',
  'AGENT_AUTH_REQUIRED',
  'AGENT_RATE_LIMITED',
  'AGENT_CONTEXT_EXCEEDED',
  'AGENT_UPSTREAM_ERROR',
  'AGENT_SANDBOX_ERROR',
  'AGENT_DISABLED',
  'MODEL_NOT_SUPPORTED',
  'SESSION_NOT_RESUMABLE',
  'WORKSPACE_SETUP_FAILED',
  'GIT_ERROR',
  'GIT_PUSH_BLOCKED',
  'WEB_TURN_TIMEOUT',
  'HUB_SHUTDOWN',
  'INTERNAL',
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export interface AgentError {
  code: AgentErrorCode;
  /** 给人看的中文说明；不含凭据和完整提示词。 */
  message: string;
  /** 不改任何东西直接追问重试，有没有可能成功。 */
  retryable: boolean;
  detail?: JsonValue;
}

/** HTTP / WS 接口的错误码；描述“这个请求为什么被拒绝”。与 AgentErrorCode 不混用。 */
export const API_ERROR_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN_SCOPE: 403,
  ADMIN_ONLY: 403,
  TASK_NOT_OWNED: 403,
  ORIGIN_FORBIDDEN: 403,
  BRIDGE_IN_PLACE_WRITE_FORBIDDEN: 403,
  HOST_FORBIDDEN: 421,
  VALIDATION_FAILED: 400,
  MODEL_NOT_SUPPORTED: 400,
  REPO_INVALID: 400,
  CONFIG_INVALID: 400,
  NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  TURN_NOT_FOUND: 404,
  APPROVAL_NOT_FOUND: 404,
  AGENT_NOT_FOUND: 404,
  REPO_NOT_FOUND: 404,
  TOKEN_NOT_FOUND: 404,
  DIFF_NOT_AVAILABLE: 404,
  AGENT_DISABLED: 409,
  TASK_BUSY: 409,
  TASK_ARCHIVED: 409,
  TASK_NOT_ARCHIVED: 409,
  WORKSPACE_REMOVED: 409,
  ILLEGAL_TRANSITION: 409,
  APPROVAL_NOT_PENDING: 409,
  IDEMPOTENCY_CONFLICT: 409,
  WORKSPACE_DIRTY: 409,
  MERGE_CONFLICT: 409,
  GIT_IDENTITY_MISSING: 409,
  NOTHING_TO_APPLY: 409,
  APPLY_NOT_SUPPORTED: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  QUEUE_FULL: 503,
  SHUTTING_DOWN: 503,
} as const satisfies Record<string, number>;
export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: JsonValue;
  };
}
```

`AgentErrorCode` 出现在 `turn.completed` 事件、`TurnDto.error`、`TaskDto.lastError` 里，说明“这一轮为什么没有正常结束”；`ApiErrorCode` 只出现在 HTTP / WS 的错误响应里（[local-api.md](local-api.md) §7）。两套码不混用。

| `AgentErrorCode`          | 何时                                                                                      | 产出方                       | `retryable`                                   | 轮 / 任务状态                                   |
| ------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------- | ----------------------------------------------- |
| `AGENT_BINARY_NOT_FOUND`  | 命令在登录 PATH 里找不到，或绝对路径不可执行。                                            | 适配器                       | `false`                                       | `failed`                                        |
| `AGENT_SPAWN_FAILED`      | `spawn` 失败（权限、cwd 不存在等）。                                                      | `ProcessSupervisor`          | `false`                                       | `failed`                                        |
| `AGENT_HANDSHAKE_TIMEOUT` | `initialize` 30 秒没有响应。                                                              | 适配器                       | `true`                                        | `failed`                                        |
| `AGENT_PROTOCOL_ERROR`    | 非握手请求超时（60 秒）、返回 JSON-RPC 错误、响应结构不对、连接在请求途中关闭但进程还在。 | 适配器                       | 超时、连接中断 `true`；Agent 返回错误 `false` | `failed`                                        |
| `AGENT_PROCESS_EXITED`    | 会话期间 Agent 进程退出。                                                                 | 适配器                       | `true`                                        | `interrupted`（`startSession` 阶段为 `failed`） |
| `AGENT_AUTH_REQUIRED`     | 未登录或登录过期。                                                                        | 适配器                       | `false`                                       | `failed`                                        |
| `AGENT_RATE_LIMITED`      | 用量、频率或预算超限。                                                                    | 适配器                       | `true`                                        | `failed`                                        |
| `AGENT_CONTEXT_EXCEEDED`  | 上下文窗口用尽。                                                                          | 适配器                       | `false`                                       | `failed`                                        |
| `AGENT_UPSTREAM_ERROR`    | 其他上游（模型服务）错误。                                                                | 适配器                       | 按适配器分册                                  | `failed`                                        |
| `AGENT_SANDBOX_ERROR`     | Agent 的沙箱报错。                                                                        | 适配器                       | `false`                                       | `failed`                                        |
| `AGENT_DISABLED`          | 任务排队期间 Agent 配置被禁用或删除（[architecture.md](architecture.md) §4）。            | `TaskRunner`                 | `false`                                       | `failed`                                        |
| `MODEL_NOT_SUPPORTED`     | Agent 拒绝了指定的模型或推理档位。                                                        | 适配器                       | `false`                                       | `failed`                                        |
| `SESSION_NOT_RESUMABLE`   | 需要恢复原生会话，但 Agent 不支持或恢复失败。                                             | 适配器                       | `false`                                       | `failed`                                        |
| `WORKSPACE_SETUP_FAILED`  | worktree 创建、`worktreeSetup`、仓库没有提交、网页任务分支准备失败。                      | `TaskRunner`                 | `false`                                       | `failed`                                        |
| `GIT_ERROR`               | 轮前 / 轮后快照或 diff 计算失败；网页任务本轮开始时拉取远端任务分支失败。                 | `TaskRunner`、网页适配器     | `true`                                        | `failed`                                        |
| `GIT_PUSH_BLOCKED`        | 网页任务分支推送被守卫拦截（[security.md](security.md) §3）。                             | `PushService`                | `false`                                       | `failed`                                        |
| `WEB_TURN_TIMEOUT`        | 网页任务一轮超过 `maxTurnMinutes`。                                                       | 网页适配器                   | `true`                                        | `failed`                                        |
| `HUB_SHUTDOWN`            | 侧车停机时轮还没结束。                                                                    | 核心 / 适配器（§6.1 规则 5） | `true`                                        | `interrupted`                                   |
| `INTERNAL`                | 未预料的异常（程序错误）；`message` 固定为“Agent Hub 内部错误，详见日志”，堆栈只进日志。  | `TaskRunner`                 | `false`                                       | `failed`                                        |

`message` 是给人看的中文，带上 Agent 名和可操作的建议（例如“Codex 未登录或登录已过期：请在 ChatGPT 应用或终端里执行 codex login 后重试”）；不含凭据、不含提示词全文。`detail` 放协议原始错误（核心落库前脱敏）。

## 5. 审批

### 5.1 流程与结局

适配器收到 Agent 的权限请求后，组装 `ApprovalRequestInput`（§6），调用 `sink.requestApproval(input, signal)` 并等待结果，再按协议回复 Agent。`signal` 由适配器持有：Agent 撤回请求、本轮结束、进程退出时适配器中止它。

`sink.requestApproval` 由核心的 `ApprovalService.request(taskId, turnId, input, signal)` 实现：

| 步骤 | 动作                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `signal` 已中止 → 立即返回 `{ withdrawn: true }`，不落库。                                                                                                                                                                                                                                       |
| 2    | 该任务当前的轮不是 `running`（例如 Agent 在建会话时就发来请求）→ 记 `warn` 日志，立即返回 `{ decision: fallback }`，不落库。                                                                                                                                                                     |
| 3    | `options` 按 `APPROVAL_DECISIONS` 的顺序去重；为空时按 `['cancel_turn']` 处理并记 `warn`。`fallback` = `options` 含 `reject` 时为 `reject`，否则为 `cancel_turn`。                                                                                                                               |
| 4    | 同一个事务：插入审批（`id = randomUUID()`，`pending`，`request` = 脱敏后的 `{ command, cwd, paths, reason, detail }`，`expires_at = now + security.approvalTimeoutMinutes`）；任务 `pending_approvals + 1`；追加 `approval.requested` 事件（带 `ApprovalDto`）。提交后广播任务与审批的对象变化。 |
| 5    | 登记等待者：超时定时器（到 `expires_at`）、`signal` 的 `abort` 监听。返回的 Promise 在下表任一结局发生时 resolve，**永不 reject**。                                                                                                                                                              |

所有结局都经同一个 `settle(id, status, decision, decidedBy, tokenId, note)`：同一个事务里执行 [data-model.md](data-model.md) §4.3 的“结束审批”语句（只改 `pending` 的行）、`pending_approvals − 1`、追加 `approval.resolved` 事件、写审计；没改到行说明已被别的结局抢先，什么都不做。改到了才 resolve 等待者、清掉定时器和监听。

| 结局       | 触发                                                                              | 库里 `status` / `decision` / `decided_by`          | 审计               | 返回给适配器             | 之后                                                                     |
| ---------- | --------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------ | ------------------------ | ------------------------------------------------------------------------ |
| 人做决定   | `POST /approvals/:id/decision`（[local-api.md](local-api.md) §5.8）               | `approved` 或 `rejected` / 该决定 / `ui`、`bridge` | `approval.decided` | `{ decision }`           | 决定是 `cancel_turn` 时 `TaskService.cancel(taskId, { force: false })`。 |
| 超时       | 到 `expires_at`                                                                   | `expired` / `fallback` / `system`                  | `approval.expired` | `{ decision: fallback }` | `fallback` 是 `cancel_turn` 时同上，取消本轮。                           |
| 停机       | `ApprovalService.expireAll()`（[architecture.md](architecture.md) §10.3 第 2 步） | `expired` / `fallback` / `system`                  | `approval.expired` | `{ decision: fallback }` | 停机流程接着取消所有轮。                                                 |
| 适配器撤回 | `signal` 中止                                                                     | `withdrawn` / `NULL` / `system`                    | —                  | `{ withdrawn: true }`    | —                                                                        |
| 轮结束兜底 | `prompt()` resolve 后 `TaskRunner` 调 `withdrawAll(turnId)`                       | `withdrawn` / `NULL` / `system`                    | —                  | `{ withdrawn: true }`    | 正常情况下不会触发（适配器应已中止 `signal`），触发时记 `warn`。         |
| 侧车重启   | 启动恢复流程（[architecture.md](architecture.md) §9.3）                           | `expired` / `NULL` / `system`                      | `approval.expired` | 无（进程已不在）         | `pending_approvals` 归零。                                               |

- `approved` = `allow_once` / `allow_for_session`；`rejected` = `reject` / `cancel_turn`。超时和停机的 `decision` 记的是**实际回复给 Agent 的决定**。
- 人做决定与超时同时发生时，`settle` 里的条件更新保证只有一个生效；输的一方如果是人，返回 `409 APPROVAL_NOT_PENDING`。
- 审批卡片的倒计时用 `expiresAt`；`withdrawn` 的卡片变灰，显示“Agent 已撤回此请求或本轮已结束”。

### 5.2 决定怎么回复给 Agent

| Hub 决定            | Codex 命令执行 / 文件修改（`decision`）                    | Codex `item/permissions/requestApproval`              | ACP `session/request_permission`（`outcome`）                    |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `allow_once`        | `accept`                                                   | 授予所请求的权限，`scope: "turn"`                     | `selected`，选 `kind: allow_once` 的选项                         |
| `allow_for_session` | `acceptForSession`                                         | 授予所请求的权限，`scope: "session"`                  | 不提供（D59）                                                    |
| `reject`            | `decline`                                                  | `{ permissions: {}, scope: "turn" }`                  | `selected`，选 `kind: reject_once` 的选项                        |
| `cancel_turn`       | `cancel`                                                   | `{ permissions: {}, scope: "turn" }`                  | `cancelled`（随后核心取消本轮，适配器发 `session/cancel`）       |
| 撤回（`withdrawn`） | Agent 已发 `serverRequest/resolved`：不回复；否则 `cancel` | 同左：不回复，或 `{ permissions: {}, scope: "turn" }` | Agent 发过 `$/cancel_request`：回错误 `-32800`；否则 `cancelled` |

**可选决定（`options`）**：

- Codex：三类请求都给全部四个决定。
- ACP：按请求里的选项生成（`permissionDecisions()`）：有 `allow_once` 选项 → `allow_once`；有 `reject_once` → `reject`；`cancel_turn` 总是有。`allow_always` / `reject_always` 永远不用，所以 ACP 没有 `allow_for_session`（D59：Claude Code 的 `allow_always` 会把规则写进项目设置，“退出计划模式”的 `allow_always` 选项会切到跳过审批的模式）。没有 `reject_once` 时只能用“取消本轮”来拒绝。
- 网页 Agent 没有审批。

### 5.3 审批类型与标题

| 来源                                               | `kind`                                               | `title`（中文）                                    |
| -------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Codex `item/commandExecution/requestApproval`      | `command`；`networkApprovalContext` 非空 → `network` | “执行命令” / “向进程写入输入” / “访问网络：<host>” |
| Codex `item/fileChange/requestApproval`            | `file_change`                                        | “修改 N 个文件” / “授予目录写权限：<目录>”         |
| Codex `item/permissions/requestApproval`           | 申请联网 → `network`，否则 `other`                   | “申请联网权限” / “申请额外的文件权限”              |
| ACP，`toolCall.kind` 为 `execute`                  | `command`                                            | 见 [adapter-acp.md](adapter-acp.md) §7             |
| ACP，`toolCall.kind` 为 `edit` / `delete` / `move` | `file_change`                                        | 同上                                               |
| ACP，`toolCall.kind` 为 `fetch`                    | `network`                                            | 同上                                               |
| ACP，其他 `kind` 或缺省                            | `other`                                              | 同上                                               |

Codex 的 `item/tool/requestUserInput`、MCP elicitation 不是审批：适配器直接回空答案 / 拒绝，并发 `notice`（§3.2）。桥接方默认没有 `approvals:decide`，不能审批（D44）。

## 6. 运行时接口

```ts
// server/src/adapters/types.ts
import type { Readable, Writable } from 'node:stream';
import type {
  AdapterKind,
  AgentCapabilities,
  AgentError,
  AgentEvent,
  AgentHealth,
  ApprovalDecision,
  ApprovalKind,
  JsonValue,
  StopReason,
  TaskMode,
  UsageInfo,
  WorkspaceKind,
} from '@agent-hub/contract';

/** 网页 Agent 的任务分支（web-agent.md §3）。 */
export interface RemoteBranchWorkspace {
  /** git remote 名，即仓库配置的 internalRemote。 */
  remote: string;
  /** agent-hub/<shortId>。 */
  branch: string;
  baseCommit: string;
  /** internal 的推送地址，已去掉 userinfo；显示给人填进 AoneD。 */
  repoUrl: string;
}

export interface StartSessionParams {
  taskId: string;
  shortId: string;
  /** Agent 的工作目录（绝对路径）。remote_branch 时是原仓库路径，只用于 git 操作。 */
  cwd: string;
  mode: TaskMode;
  workspace: WorkspaceKind;
  /** 有值时恢复这个原生会话（追问且活动会话表里没有会话时）。 */
  resumeNativeSessionId: string | null;
  /** Codex threadSource "user"（D31）；其他适配器忽略。 */
  userVisible: boolean;
  /** 只有 remote_branch 有值。 */
  remote: RemoteBranchWorkspace | null;
  /** 任务在 preparing 阶段被取消时中止。 */
  signal: AbortSignal;
}

export interface PromptInput {
  turnId: string;
  /** 轮序号，从 1 开始。 */
  index: number;
  text: string;
  /** 本轮要用的模型；null = Agent 自己的默认值。 */
  model: string | null;
  reasoningEffort: string | null;
}

export interface TurnResult {
  stopReason: StopReason;
  /** stopReason 为 'error' 时必有。 */
  error?: AgentError;
  usage?: UsageInfo;
  /** Codex 的 turn id；ACP、网页没有。 */
  nativeTurnId?: string;
}

export interface ApprovalRequestInput {
  kind: ApprovalKind;
  /** 一句话中文标题，例如“执行命令”“修改 3 个文件”。 */
  title: string;
  command?: string;
  cwd?: string;
  paths?: string[];
  reason?: string;
  /** 协议原始请求的参数（核心落库前脱敏）。 */
  detail?: JsonValue;
  /** 非空；按协议给出的选项过滤后的决定（§5.2）。 */
  options: ApprovalDecision[];
}

/**
 * decision：人做了决定，或系统代为决定（超时、停机、无进行中的轮，§5.1）；
 * withdrawn：适配器自己中止了 signal（Agent 撤回请求、本轮结束、进程退出）。
 */
export type ApprovalOutcome = { decision: ApprovalDecision } | { withdrawn: true };

/** 核心交给适配器的回调；一个会话一个 sink，由 TaskRunner 创建。 */
export interface AgentEventSink {
  emit(event: AgentEvent): void;
  /** 落库并广播一条 pending 审批，等待结局。永不 reject。 */
  requestApproval(input: ApprovalRequestInput, signal: AbortSignal): Promise<ApprovalOutcome>;
  /** 原始协议帧（一行 JSON）；诊断开关关闭时是空操作。 */
  raw(direction: 'in' | 'out', frame: string): void;
}

export type DisposeReason =
  | 'idle'
  | 'cancelled'
  | 'shutdown'
  | 'agent_exited'
  | 'config_changed'
  | 'deleted';

export interface AgentSession {
  readonly nativeSessionId: string;
  /** 发出提示词，本轮结束时 resolve。同一会话同一时刻只有一个 prompt。不因 Agent 的业务错误而 reject。 */
  prompt(input: PromptInput): Promise<TurnResult>;
  /** 协议级中断当前轮；没有进行中的轮时什么都不做。幂等，不抛错。 */
  cancelTurn(): Promise<void>;
  /** 释放会话占用的资源。进行中的 prompt 随之 resolve（§6.1 规则 5）。幂等，不抛错。 */
  dispose(reason: DisposeReason): Promise<void>;
  /** 会话不能再用时 resolve：被 dispose，或 Agent 进程退出。 */
  readonly closed: Promise<void>;
}

/** 网页 Agent 的会话多一个“完成本轮”（web-agent.md §3.3）。 */
export interface WebSession extends AgentSession {
  completeTurn(): Promise<void>;
}

export function isWebSession(session: AgentSession): session is WebSession {
  return typeof (session as Partial<WebSession>).completeTurn === 'function';
}

export interface ProbeResult {
  health: AgentHealth;
  capabilities: AgentCapabilities;
}

export interface AgentAdapter {
  /** config.json 里的 agents[].id。 */
  readonly id: string;
  readonly kind: AdapterKind;
  /** 缓存的能力；构造后立即可用（还没探测到的部分为空），同步返回。 */
  capabilities(): AgentCapabilities;
  /** 健康检查并刷新能力（§9.2）。不抛错：失败体现在 health 里。 */
  probe(): Promise<ProbeResult>;
  /** 新建或恢复原生会话。失败抛 AgentFailure。 */
  startSession(params: StartSessionParams, sink: AgentEventSink): Promise<AgentSession>;
  /** 侧车停机或配置变更：结束全部会话和子进程。幂等。 */
  shutdown(): Promise<void>;
}

/** startSession 的失败；TaskRunner 把 error 写进轮和任务的 lastError。 */
export class AgentFailure extends Error {
  constructor(readonly error: AgentError) {
    super(error.message);
  }
}

/** 协议对象 → JsonValue（丢掉 undefined 字段），用于 AgentError.detail 与审批 detail。 */
export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

export function agentError(
  code: AgentError['code'],
  message: string,
  retryable: boolean,
  detail?: JsonValue,
): AgentError {
  return detail === undefined ? { code, message, retryable } : { code, message, retryable, detail };
}

export interface AdapterLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** 适配器主动上报的状态变化；AdapterRegistry 更新缓存，GET /agents 读取（§9.2）。 */
export interface AdapterReporter {
  health(health: AgentHealth): void;
  capabilities(capabilities: AgentCapabilities): void;
}

export interface AdapterDeps {
  supervisor: ProcessSupervisor;
  logger: AdapterLogger;
  report: AdapterReporter;
  /** Agent 子进程的环境变量（GitGuard 构造，含推送守卫与 envPassthrough，security.md §3.2）。 */
  agentEnv(): Record<string, string>;
  now(): Date;
  /** 侧车版本（server/package.json 的 version），握手时作为 clientInfo.version。 */
  hubVersion: string;
  /** ACP 探测进程的 cwd：<AGENT_HUB_HOME>/probe，侧车启动时创建的空目录（adapter-acp.md §4.2）。 */
  probeCwd: string;
}

export interface SpawnSpec {
  /** 绝对路径，先用 resolveExecutable 解析。 */
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** 日志与 processes 表用，例如 "codex:codex"、"acp:qoder:3f9a1c2b"、"setup:3f9a1c2b"。 */
  label: string;
  taskId: string | null;
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface TerminateOptions {
  /** 关闭 stdin 后等多久再发 SIGTERM，默认 3000。 */
  stdinGraceMs?: number;
  /** SIGTERM 后等多久再发 SIGKILL，默认 2000。 */
  termGraceMs?: number;
}

export interface ManagedProcess {
  readonly pid: number;
  readonly label: string;
  readonly stdin: Writable;
  readonly stdout: Readable;
  /** 进程（组长）退出时 resolve，永不 reject。 */
  readonly exited: Promise<ExitInfo>;
  /** stderr 的最后 4 KB（原文，写日志前要 redact）。 */
  stderrTail(): string;
  /** 关闭 stdin → 等待 → SIGTERM 进程组 → 等待 → SIGKILL 进程组。幂等。 */
  terminate(options?: TerminateOptions): Promise<ExitInfo>;
}

export interface ProcessSupervisor {
  /** 登录 shell 的 PATH（§8.1）。 */
  loginPath(): Promise<string>;
  /** 命令名按登录 PATH 解析成绝对路径；绝对路径则检查可执行。找不到返回 null。 */
  resolveExecutable(command: string): Promise<string | null>;
  /** 以独立进程组启动并登记到 processes 表。启动失败抛 AgentFailure（AGENT_SPAWN_FAILED）。 */
  spawn(spec: SpawnSpec): Promise<ManagedProcess>;
  /** 侧车启动时清理上次残留的进程组，返回清理的组数（§8.3）。 */
  cleanupOrphans(): Promise<number>;
  /** 停机：并行 terminate 全部存活进程。 */
  terminateAll(options?: TerminateOptions): Promise<void>;
}
```

### 6.1 实现规则

1. **适配器只拿参数和 `AdapterDeps`**：不访问数据库、不读 `process.env`（环境用 `deps.agentEnv()`）、不自己选工作目录、不写文件（transcript 经 `sink.raw`）。这样单测可以全部用假依赖。
2. **`startSession` 的失败**：抛 `AgentFailure`，`TaskRunner` 把 `error` 写进轮和任务的 `lastError`，轮与任务 → `failed`（停机期间除外，见规则 4 最后一行）。抛了别的异常按 `INTERNAL` 处理。`signal` 在 `startSession` 期间中止时，适配器清理已经建好的东西（Codex `thread/unsubscribe`、ACP 结束进程组）后抛任意错误；`TaskRunner` 看到 `signal.aborted` 就记 `cancelled`，不看错误内容。
3. **`prompt()` 不 reject**：Agent 的业务错误、协议错误、进程退出都映射成 `TurnResult`。只有程序错误才会抛出，`TaskRunner` 捕获后按 `INTERNAL` 结束本轮。
4. **`TurnResult` 到轮状态**（`TaskRunner`；任务状态跟随轮）：

   | `TurnResult`                                          | 轮 / 任务     | 另外                                                      |
   | ----------------------------------------------------- | ------------- | --------------------------------------------------------- |
   | `end_turn`                                            | `completed`   | —                                                         |
   | `max_tokens` / `max_turn_requests` / `refusal`        | `completed`   | `notice`（`warning`，`TURN_LIMIT`），文案说明是哪种原因。 |
   | `cancelled`                                           | `cancelled`   | —                                                         |
   | `error`，码为 `AGENT_PROCESS_EXITED` / `HUB_SHUTDOWN` | `interrupted` | `lastError` = `error`                                     |
   | `error`，其他码                                       | `failed`      | `lastError` = `error`                                     |
   | 侧车停机期间结束、且不是 `end_turn`                   | `interrupted` | `lastError` = `HUB_SHUTDOWN`（不管 `TurnResult` 是什么）  |

5. **`dispose` 时进行中的 `prompt()`**：立即以下表的结果 resolve，未决审批的 `signal` 全部中止：

   | `reason`                                     | `prompt()` 的结果                                                        |
   | -------------------------------------------- | ------------------------------------------------------------------------ |
   | `cancelled`                                  | `{ stopReason: 'cancelled' }`                                            |
   | `shutdown`                                   | `{ stopReason: 'error', error: HUB_SHUTDOWN（retryable true） }`         |
   | `agent_exited`（适配器发现进程退出时自己用） | `{ stopReason: 'error', error: AGENT_PROCESS_EXITED（retryable true） }` |
   | `idle` / `config_changed` / `deleted`        | `{ stopReason: 'cancelled' }`（正常不会发生：只对空闲会话调用）          |

6. **审批必有结局**：适配器维护“协议请求 id → `AbortController`”表；Agent 撤回、本轮结束、`cancelTurn`、`dispose`、进程退出时中止对应的 `signal`，进程还在就按 §5.2 回复。拿到 `{ decision }` 后立即回复 Agent。
7. **超时**：握手（Codex `initialize`、ACP `initialize`）30 秒 → `AGENT_HANDSHAKE_TIMEOUT`；其他请求用 `JsonRpcConnection` 默认的 60 秒 → `AGENT_PROTOCOL_ERROR`；ACP 的 `session/prompt` 请求不设超时（`timeoutMs: null`）；`prompt()` 本身没有总超时，由人取消（网页 Agent 的 `maxTurnMinutes` 例外）。
8. **事件**：按协议消息到达的顺序**同步**调用 `sink.emit`，中间不 `await`；增量原样产出，合并由 `EventStore` 做；`prompt()` resolve 前本轮的事件已全部发出（含 §3.1 规则 4 的补齐）。
9. **`cancelTurn()`**：发出协议级中断就返回，不等轮结束；没有进行中的轮时什么都不做；幂等、不抛错。
10. **`closed`**：被 `dispose` 或进程退出时 resolve。`TaskRunner` 在 `closed` 后把会话移出活动会话表，下次追问重新 `startSession`（带 `resumeNativeSessionId`）。
11. **并发**：同一会话同一时刻只有一个 `prompt()`（`TaskRunner` 保证）；不同会话互不影响，Codex 的多个会话共享一个进程。
12. **日志**：只用 `deps.logger`；不记提示词全文（只记长度）；`meta` 由日志实现统一过 `redact()`。
13. **`capabilities()`** 同步返回缓存；**`probe()`** 不抛错，失败体现在 `health` 里；能力或健康有变化时调 `deps.report`。

### 6.2 调用时机

| 调用                                 | 调用方            | 何时                                                                                      |
| ------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------- |
| `adapter.probe()`                    | `AdapterRegistry` | 侧车启动后、`POST /agents/:id/refresh`、该 Agent 配置变更后（§9.2）。                     |
| `adapter.startSession(params, sink)` | `TaskRunner`      | 一轮开始时活动会话表里没有该任务的会话（[architecture.md](architecture.md) §5 第 3 步）。 |
| `session.prompt(input)`              | `TaskRunner`      | 第 6 步。                                                                                 |
| `session.cancelTurn()`               | `TaskRunner`      | 取消 `running` 的任务；停机第 2 步。                                                      |
| `session.dispose('cancelled')`       | `TaskRunner`      | 取消后 10 秒还没结束、`force: true`、`preparing` 阶段被取消。                             |
| `session.dispose('idle')`            | `TaskRunner`      | 任务进入终态后闲置满 `idleTimeoutMinutes`（Codex 30、ACP 10）；追问开始时取消计时器。     |
| `session.dispose('config_changed')`  | `AdapterRegistry` | 该 Agent 配置变更或被禁用时，对空闲会话。                                                 |
| `session.dispose('deleted')`         | `TaskService`     | 删除任务时（会话还在表里）。                                                              |
| `session.dispose('shutdown')`        | 停机流程          | [architecture.md](architecture.md) §10.3 第 3 步。                                        |
| `WebSession.completeTurn()`          | `TaskService`     | `POST /tasks/:id/remote/done`（[web-agent.md](web-agent.md) §3.3）。                      |
| `adapter.shutdown()`                 | `AdapterRegistry` | 停机第 3 步；替换或禁用该 Agent 时（活动会话已全部结束后）。                              |

### 6.3 核心一侧的 sink

`TaskRunner` 为每个会话创建一个 sink，绑定 `taskId`：

- `emit(event)`：事件归到该任务**当前的轮**（`preparing` 阶段建会话时也是这一轮）。当前轮不在 `pending` / `running`（轮已结束后迟到的通知）→ 丢弃并记 `debug`。其余交给 `EventStore.append`（[architecture.md](architecture.md) §6）。
- `emit` 收到 `remote.updated`：落库后再调 `void taskRunner.liveDiff(taskId, { fetch: false })`，让 Diff 页签自动更新（[web-agent.md](web-agent.md) §4.2）。
- `requestApproval(input, signal)` → `ApprovalService.request(taskId, currentTurnId, input, signal)`（§5.1）。
- `raw(direction, frame)`：`diagnostics.recordTranscripts` 打开时，脱敏后追加一行 `{"ts","dir","frame"}` 到 `transcripts/<taskId>.ndjson`；关闭时直接返回。Codex 共享进程的帧按 `threadId` 分到各任务，不属于任何任务的帧（握手、`model/list`）只进 `debug` 日志。

## 7. JSON-RPC 行传输

Codex app-server 与 ACP 都是“stdio 上每行一个 JSON-RPC 消息”，共用一个实现。

```ts
// server/src/adapters/jsonrpc/connection.ts
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
```

### 7.1 行为

| 方面       | 规则                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分帧       | 按 `\n` 切分（容忍 `\r\n`），空行跳过；UTF-8 多字节字符跨 chunk 时由 `setEncoding('utf8')` 正确拼接。一行超过 32 MiB → `onInvalidLine` 后关闭连接。                          |
| 请求 id    | 本端从 0 开始递增的整数；对端的 id 可以是数字或字符串，原样回复。                                                                                                            |
| 消息分类   | 有 `method` 且有 `id` → 对端请求；有 `method` 无 `id` → 通知；有 `id` 且有 `result` / `error` → 响应；未知 id 的响应忽略；其他 → `onInvalidLine`。                           |
| 对端请求   | 没设处理器 → `-32601`；处理器抛 `JsonRpcError` → 原样回 `code` / `message` / `data`；抛其他异常 → `-32603 "Internal error"`（不泄露内部信息）；返回 `NO_RESPONSE` → 不回复。 |
| 超时与中止 | `request()` 默认 60 秒超时（`JsonRpcTimeoutError`），`timeoutMs: null` 不超时；`signal` 中止时以 `signal.reason` reject，不再等响应。                                        |
| 关闭       | 输入流 `end` / `close` / `error`、输出流 `error` / `close` 都会关闭；关闭后未完成的请求以 `JsonRpcClosedError` 失败，新 `request()` 立即失败，`notify()` 与回复静默丢弃。    |
| 非 JSON 行 | Agent 往 stdout 打了日志：`onInvalidLine`（适配器记 `debug`），不中断连接。                                                                                                  |
| 原始帧     | 每一行收发都经 `onRaw`（不含换行符），适配器转给 `sink.raw`。                                                                                                                |
| 批量       | 不支持（两个协议都不用）。                                                                                                                                                   |

### 7.2 两个协议的差异

| 方面           | Codex app-server                                     | ACP                                                                                       |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `jsonrpc` 字段 | 不带（`includeJsonrpcField: false`），对端回复也不带 | 带 `"2.0"`（`includeJsonrpcField: true`）                                                 |
| 进程           | 每个 Codex 配置一个，多个会话共享                    | 每个任务一个                                                                              |
| 对端请求       | 审批、用户输入、MCP elicitation 等                   | `session/request_permission`（`fs/*`、`terminal/*` 不会来，D36；来了回 `-32601`）         |
| stdin 关闭后   | 立即退出（实测 12 ms）                               | 不保证退出（三个 Agent 实测都在 1.4 秒内退出，但需求方反馈过 Qoder 不退出；按不保证处理） |

### 7.3 已实测的场景

在 Node 22 上用 `PassThrough` 流和真实子进程验证过：多字节字符跨 chunk、`jsonrpc` 字段开关、对端返回错误、超时、`signal` 中止、对端请求（含处理器抛错与 `NO_RESPONSE`）、非 JSON 行、关闭时 reject 全部未完成请求、超长行关闭连接、通过真实子进程的 stdin / stdout 往返。这些场景要写成 `server/test/adapters/jsonrpc.spec.ts`（[testing.md](testing.md) §3）。

## 8. 子进程管理

```ts
// server/src/adapters/process/supervisor.ts
import { execFile, spawn as spawnChild } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import {
  AgentFailure,
  agentError,
  type AdapterLogger,
  type ExitInfo,
  type ManagedProcess,
  type ProcessSupervisor,
  type SpawnSpec,
  type TerminateOptions,
} from '../types';

/** processes 表的一行（data-model.md §3.3）。 */
export interface ProcessRow {
  pid: number;
  pgid: number;
  label: string;
  command: string;
  taskId: string | null;
  startedAt: string;
}

/** processes.repo.ts 绑定 Db 后的三个函数。 */
export interface ProcessTable {
  insert(row: ProcessRow): void;
  remove(pid: number): void;
  list(): ProcessRow[];
}

export const FALLBACK_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

/** 停机时用更短的宽限期：侧车要在 Rust 壳的 10 秒内退出（architecture.md §10.3）。 */
export const SHUTDOWN_TERMINATE: TerminateOptions = { stdinGraceMs: 1000, termGraceMs: 1500 };

const STDERR_TAIL_CHARS = 4096;

export class NodeProcessSupervisor implements ProcessSupervisor {
  private readonly live = new Map<number, ManagedProcess>();
  private loginPathPromise: Promise<string> | null = null;

  constructor(
    private readonly table: ProcessTable,
    private readonly logger: AdapterLogger,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly now: () => Date = () => new Date(),
  ) {}

  loginPath(): Promise<string> {
    this.loginPathPromise ??= readLoginPath(this.env);
    return this.loginPathPromise;
  }

  async resolveExecutable(command: string): Promise<string | null> {
    if (command.includes('/')) {
      const path = command.startsWith('~/') ? join(homedir(), command.slice(2)) : command;
      return isAbsolute(path) && (await isExecutableFile(path)) ? path : null;
    }
    for (const dir of (await this.loginPath()).split(delimiter)) {
      if (!isAbsolute(dir)) continue;
      const candidate = join(dir, command);
      if (await isExecutableFile(candidate)) return candidate;
    }
    return null;
  }

  async spawn(spec: SpawnSpec): Promise<ManagedProcess> {
    const child = spawnChild(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    } catch (err) {
      throw new AgentFailure(
        agentError(
          'AGENT_SPAWN_FAILED',
          `无法启动 ${spec.label}：${(err as Error).message}`,
          false,
        ),
      );
    }
    const pid = child.pid!;
    child.on('error', (err) =>
      this.logger.warn('子进程错误', { label: spec.label, pid, err: err.message }),
    );
    child.stdin.on('error', () => undefined);

    let stderrTail = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
      this.logger.debug('子进程 stderr', { label: spec.label, pid, text: chunk.slice(0, 2048) });
    });

    this.table.insert({
      pid,
      pgid: pid,
      label: spec.label,
      command: spec.command,
      taskId: spec.taskId,
      startedAt: this.now().toISOString(),
    });

    let hasExited = false;
    const exited = new Promise<ExitInfo>((resolve) => {
      // 用 'exit' 而不是 'close'：孙进程继承了管道时 'close' 可能永远不来。
      child.once('exit', (code, signal) => {
        hasExited = true;
        this.live.delete(pid);
        this.table.remove(pid);
        killGroup(pid, 'SIGTERM', this.logger);
        this.logger.info('子进程退出', { label: spec.label, pid, code, signal });
        resolve({ code, signal });
      });
    });

    let terminating: Promise<ExitInfo> | null = null;
    const managed: ManagedProcess = {
      pid,
      label: spec.label,
      stdin: child.stdin,
      stdout: child.stdout,
      exited,
      stderrTail: () => stderrTail,
      terminate: ({ stdinGraceMs = 3000, termGraceMs = 2000 }: TerminateOptions = {}) => {
        terminating ??= (async () => {
          if (!hasExited) {
            child.stdin.end();
            if (!(await settlesWithin(exited, stdinGraceMs))) {
              killGroup(pid, 'SIGTERM', this.logger);
              if (!(await settlesWithin(exited, termGraceMs)))
                killGroup(pid, 'SIGKILL', this.logger);
            }
          }
          const info = await exited;
          killGroup(pid, 'SIGKILL', this.logger);
          return info;
        })();
        return terminating;
      },
    };
    this.live.set(pid, managed);
    return managed;
  }

  async cleanupOrphans(): Promise<number> {
    const rows = this.table.list();
    if (rows.length === 0) return 0;
    let cleaned = 0;
    const snapshot = await listProcesses();
    for (const row of rows) {
      this.table.remove(row.pid);
      const members = snapshot.filter((p) => p.pgid === row.pgid);
      if (members.length === 0) continue;
      const leader = members.find((p) => p.pid === row.pgid);
      // 组长还在但命令行对不上：pid 已被别的程序复用，这个组不是我们的。
      if (leader && !leader.command.includes(row.command)) continue;
      killGroup(row.pgid, 'SIGTERM', this.logger);
      if (!(await groupGoneWithin(row.pgid, 2000))) killGroup(row.pgid, 'SIGKILL', this.logger);
      this.logger.warn('清理了上次残留的进程组', { label: row.label, pgid: row.pgid });
      cleaned++;
    }
    return cleaned;
  }

  async terminateAll(options?: TerminateOptions): Promise<void> {
    await Promise.all([...this.live.values()].map((p) => p.terminate(options)));
  }
}

/** AGENT_HUB_LOGIN_PATH（Tauri 壳传入）→ 问登录 shell → 兜底路径。 */
export async function readLoginPath(env: NodeJS.ProcessEnv): Promise<string> {
  if (env.AGENT_HUB_LOGIN_PATH) return env.AGENT_HUB_LOGIN_PATH;
  const shell = env.SHELL && isAbsolute(env.SHELL) ? env.SHELL : '/bin/zsh';
  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        shell,
        ['-ilc', 'printf "__AH__%s__AH__" "$PATH"'],
        { timeout: 5000, killSignal: 'SIGKILL', encoding: 'utf8', env: { ...env, TERM: 'dumb' } },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
    const match = /__AH__(.+?)__AH__/s.exec(out);
    if (match?.[1]) return match[1];
  } catch {
    // 登录 shell 出错或超时：用兜底路径
  }
  return [FALLBACK_PATH, env.PATH].filter(Boolean).join(delimiter);
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function killGroup(pgid: number, signal: NodeJS.Signals, logger: AdapterLogger): void {
  try {
    process.kill(-pgid, signal);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH' && code !== 'EPERM') logger.warn('结束进程组失败', { pgid, signal, code });
  }
}

function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

interface PsEntry {
  pid: number;
  pgid: number;
  command: string;
}

function listProcesses(): Promise<PsEntry[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      ['-A', '-o', 'pid=,pgid=,command='],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        const entries: PsEntry[] = [];
        for (const line of stdout.split('\n')) {
          const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
          if (match)
            entries.push({ pid: Number(match[1]), pgid: Number(match[2]), command: match[3]! });
        }
        resolve(entries);
      },
    );
  });
}

async function groupGoneWithin(pgid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!(await listProcesses()).some((p) => p.pgid === pgid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}
```

### 8.1 登录 PATH 与可执行文件

从 Finder 启动的应用只有最小 PATH，`codex`、`qodercli` 往往装在 Homebrew、npm 全局目录或 `~/.local/bin` 里。按顺序取：

1. 环境变量 `AGENT_HUB_LOGIN_PATH`：Tauri 壳启动侧车前用同样的登录 shell 命令取到后传入（[desktop-shell.md](desktop-shell.md) §3）。
2. 执行 `$SHELL -ilc 'printf "__AH__%s__AH__" "$PATH"'`（`SHELL` 不是绝对路径时用 `/bin/zsh`），5 秒超时、超时 SIGKILL、`TERM=dumb`；用标记截取，不受 shell 启动脚本输出的干扰。
3. 都失败：`FALLBACK_PATH` 加上侧车自己的 `PATH`。

结果在进程内缓存（侧车生命周期内不变）。`resolveExecutable(command)`：含 `/` 的视为路径（`~/` 展开），必须是绝对路径且是可执行的普通文件；否则在登录 PATH 的各个绝对目录里依次找。找不到返回 `null`，适配器据此报 `AGENT_BINARY_NOT_FOUND`（`message` 带上命令名和“在设置页填写绝对路径”的建议）。Agent 子进程的 `PATH` 也用登录 PATH（`agentEnv()` 里，[security.md](security.md) §3.2）。

### 8.2 启动与结束

- 一律 `detached: true` 启动：子进程自成进程组，`pgid = pid`；信号发给 `-pid`，能连同它派生的子孙进程一起结束。
- 监听 `'exit'` 而不是 `'close'`：孙进程继承了 stdout 管道时 `'close'` 可能永远不来。组长退出时立即对整个组发 SIGTERM，清理留下的子孙进程。
- **调用方必须持续读取 `stdout`**（JSON-RPC 连接、或 `worktreeSetup` 的输出收集），否则管道写满后子进程会阻塞。stderr 由 supervisor 自己读：保留最后 4 KB（`stderrTail()`），每块的前 2 KB 记 `debug` 日志。
- `terminate()` 的顺序与时间：

  | 步骤 | 动作                                                           | 普通（默认） | 停机（`SHUTDOWN_TERMINATE`） |
  | ---- | -------------------------------------------------------------- | ------------ | ---------------------------- |
  | 1    | 关闭 stdin，等进程自己退出                                     | 3 秒         | 1 秒                         |
  | 2    | SIGTERM 进程组，再等                                           | 2 秒         | 1.5 秒                       |
  | 3    | SIGKILL 进程组                                                 | —            | —                            |
  | 4    | 组长退出后再 SIGKILL 一次进程组（清理忽略 SIGTERM 的子孙进程） | —            | —                            |

  `terminate()` 可以重复调用，返回同一个 Promise。停机时侧车最多等 5 秒让轮结束，再用停机参数结束全部进程，总时长在 Rust 壳的 10 秒内（D7）。

### 8.3 残留进程清理

每个子进程启动后在 `processes` 表登记一行（`pid`、`pgid`、`label`、可执行文件绝对路径、`taskId`），退出时删除（[data-model.md](data-model.md) §3.3）。侧车崩溃或被强退后表里会留下记录；启动恢复流程（[architecture.md](architecture.md) §9.3）调用 `cleanupOrphans()`：

1. `ps -A -o pid=,pgid=,command=` 取当前进程快照（macOS 与 Linux 相同）。
2. 对表里每一行：先删除该行；该进程组已经没有成员 → 跳过；组长还在但命令行不包含记录的可执行文件路径 → pid 已被别的程序复用，**跳过**；否则 SIGTERM 进程组，2 秒内没走完就 SIGKILL。
3. 返回清理的组数，记 `warn` 日志。`ps` 执行失败时抛错，启动失败（`STARTUP_FAILED`）。

### 8.4 谁启动什么

| 进程               | `label`                   | `cwd`         | 生命周期                                                                                                               |
| ------------------ | ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `codex app-server` | `codex:<agentId>`         | 用户主目录    | 第一次需要时启动；每个 Codex 配置一个；不做闲置结束；退出后下次使用时重启（[adapter-codex.md](adapter-codex.md) §3）。 |
| ACP Agent          | `acp:<agentId>:<shortId>` | 任务工作目录  | 每个任务一个；会话 `dispose` 时 `terminate()`（[adapter-acp.md](adapter-acp.md) §8）。                                 |
| `worktreeSetup`    | `setup:<shortId>`         | worktree 目录 | `WorktreeService` 启动；`stdout` 由它读取并保留最后 4 KB；超时或任务取消时 `terminate()`。                             |

三者的环境都是 `deps.agentEnv()`（含推送守卫）。Hub 自己执行的 `git` 命令不经过 supervisor（时间短、不需要进程组，[architecture.md](architecture.md) §7.2）。

### 8.5 已实测的场景

在 Linux（Node 22）上用真实子进程验证过：`AGENT_HUB_LOGIN_PATH` 优先、登录 shell 取 PATH、`resolveExecutable` 的各种路径、启动失败抛 `AGENT_SPAWN_FAILED`、关闭 stdin 后正常退出、忽略 SIGTERM 的进程被升级为 SIGKILL、组长退出后孙进程被清理、`terminateAll`、残留进程清理（含 pid 被复用时跳过）。这些场景要写成 `server/test/adapters/supervisor.spec.ts`（[testing.md](testing.md) §3）。macOS 上用 owner 的机器跑同一套测试（[testing.md](testing.md) §7）。

## 9. 能力、健康与注册表

### 9.1 类型

```ts
// contract/src/capabilities.ts
import type { WorkspaceKind } from './domain';
import type { AgentErrorCode } from './errors';

export interface ReasoningEffortOption {
  /** 原样传给 Agent 的值，例如 Codex 的 "medium"。 */
  id: string;
  /** 中文标签，由 reasoningEffortLabel(id) 生成。 */
  label: string;
  description?: string;
}

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  isDefault: boolean;
  /** 空数组 = 该模型不能选推理档位。 */
  reasoningEfforts: ReasoningEffortOption[];
  defaultReasoningEffort: string | null;
}

export interface AgentCapabilities {
  models: ModelOption[];
  /**
   * agent：Agent 主动告知（Codex model/list）；
   * session：只能从最近一次会话里得知（ACP），还没有会话时 models 为空；
   * none：不能选模型（网页 Agent）。
   */
  modelsSource: 'agent' | 'session' | 'none';
  /** Agent 自带、Hub 可以要求开启的沙箱（只有 Codex）。 */
  sandbox: boolean;
  /** 进程重启后能否恢复原生会话。 */
  resume: boolean;
  /** 会话能否出现在 Agent 自己的客户端里（Codex threadSource "user"）。 */
  userVisibleSessions: boolean;
  workspaces: WorkspaceKind[];
  fetchedAt: string;
}

export type AgentHealth =
  | { status: 'checking' }
  | {
      status: 'ready';
      version: string | null;
      /** 版本在适配器分册的兼容表里。 */
      versionVerified: boolean;
      executablePath: string | null;
    }
  | { status: 'auth_required'; message: string; version: string | null }
  | { status: 'unavailable'; code: AgentErrorCode; message: string }
  | { status: 'disabled' };
```

| 适配器 | `modelsSource` | `sandbox` | `resume`                                                                       | `userVisibleSessions` | `workspaces`           |
| ------ | -------------- | --------- | ------------------------------------------------------------------------------ | --------------------- | ---------------------- |
| Codex  | `agent`        | `true`    | `true`                                                                         | `true`                | `in_place`、`worktree` |
| ACP    | `session`      | `false`   | 按 Agent 的 `initialize` 结果（`loadSession` 或 `sessionCapabilities.resume`） | `false`               | `in_place`、`worktree` |
| 网页   | `none`         | `false`   | `true`                                                                         | `false`               | `remote_branch`        |

- 推理档位的中文标签一律用 `reasoningEffortLabel(id)`（`contract/src/labels.ts`）：`default` 默认、`none` 关闭、`minimal` 最低、`low` 低、`medium` 中、`high` 高、`xhigh` 极高、`max` 最高；未知值原样显示。
- ACP 的模型列表来自**最近一次会话**返回的配置项（[adapter-acp.md](adapter-acp.md) §4），还没有会话时为空，此时创建任务不校验模型（[local-api.md](local-api.md) §5.2）。
- `health.versionVerified`：版本在对应适配器分册的兼容表里。为 `false` 时 Agent 卡片显示“未验证的版本”，不阻止使用。

### 9.2 `AdapterRegistry`

`server/src/adapters/registry.ts`，一个普通类，构造参数是 `ConfigService`、`AdapterDeps` 的组成部分和 `TaskRunner` 的活动会话查询函数。

| 方法 / 行为                  | 规则                                                                                                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 实例化                       | 对 `config.agents` 里 `enabled` 的每一项按 `kind` 创建：`codex` → `CodexAdapter`，`acp` → `AcpAdapter`（带 `profiles[config.profile]`），`web` → `WebManualAdapter`（第三个参数是 `PushService`，[web-agent.md](web-agent.md) §2.5）。禁用的不创建。                                         |
| `get(agentId)`               | 返回适配器；不存在、禁用或正在替换 → `null`（`TaskRunner` 据此报 `AGENT_DISABLED`）。                                                                                                                                                                                                        |
| `state(agentId)`             | `{ health, capabilities }`，组装 `AgentDto` 用（[local-api.md](local-api.md) §4.3）。禁用 → `{ status: 'disabled' }` 与 `null`；已启用但还没探测完 → `{ status: 'checking' }` 与 `adapter.capabilities()`。                                                                                  |
| 探测时机                     | 侧车启动第 11 步对全部启用的 Agent 并行 `probe()`；`refresh(agentId)`（`POST /agents/:id/refresh`）；配置变更后对新建的适配器。**不做定时轮询。**                                                                                                                                            |
| 运行中的更新                 | 适配器调 `deps.report.health()` / `report.capabilities()`：例如会话失败于 `AGENT_AUTH_REQUIRED` → `auth_required`；Codex 进程退出 → `unavailable`，下次成功启动后回到 `ready`；ACP 会话建成后上报新的模型列表。                                                                              |
| 配置变更 `applyConfig(next)` | 按 `id` 比较新旧配置。没变的不动。新增 → 创建并探测。删除、禁用或任何字段变了 → 先对该 Agent 的空闲会话 `dispose('config_changed')`；还有 `preparing` / `running` 的任务时标记“替换中”（调度器不给它派新任务），等这些任务全部离开这两个状态后再 `shutdown()` 旧适配器、按新配置创建并探测。 |
| `shutdown()`                 | 停机：对全部适配器并行 `shutdown()`。                                                                                                                                                                                                                                                        |
| 推送                         | Agent 状态变化**不经 WebSocket 推送**；Hub UI 每 10 秒刷新一次 `GET /agents`，打开新建任务页时立即刷新（[hub-ui.md](hub-ui.md) §4）。                                                                                                                                                        |

## 10. 新增一个 Agent

1. **说 ACP 的 Agent**（大多数情况）：在设置页或 `config.json` 加一项 `kind: "acp"`、`profile: "generic"`，填命令和参数即可。有协议怪癖时在 `server/src/adapters/acp/profiles.ts` 的 `ACP_PROFILES` 里加一个 profile（[adapter-acp.md](adapter-acp.md) §3），并把它加进 `acpAgentSchema.profile` 的枚举（漏加编译不过）；**不要**为单个 Agent 复制一份 `AcpAdapter`。
2. **全新协议**：在 `ADAPTER_KINDS`、`agentConfigSchema` 里加一个 `kind`；实现 `AgentAdapter`；在 `AdapterRegistry` 的实例化分支里注册；写一个假 Agent 覆盖 [testing.md](testing.md) §4 错误路径矩阵里的适配器行；新增 `docs/adapter-<name>.md`，结构参照 Codex 那篇（握手、会话、轮、事件映射、审批映射、取消、恢复、兼容表）。
3. **网页 Agent 的自动化**：实现 [web-agent.md](web-agent.md) §7 的驱动接口，不新增适配器类型。
4. 任何一种都要在 [decisions-and-risks.md](decisions-and-risks.md) 追加决策，说明为什么接入、默认启用与否、并发上限。
