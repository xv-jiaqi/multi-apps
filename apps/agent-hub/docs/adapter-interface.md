# 适配器接口

> 上级文档：[../README.md](../README.md)。本文定义所有适配器共同遵守的 TypeScript 接口、统一事件、审批与模型的归一化规则。各协议的具体映射见 [adapter-codex.md](adapter-codex.md)、[adapter-acp.md](adapter-acp.md)、[web-agent.md](web-agent.md)。
>
> 下面的类型是**契约草案**，实现时放进对应文件，字段可以加、语义不能改；要改语义先改本文。

## 1. 分层与放置位置

| 内容                                       | 放在哪里                                       | 谁用                       |
| ------------------------------------------ | ---------------------------------------------- | -------------------------- |
| 领域枚举、事件、能力、错误码（纯数据类型） | `@agent-hub/contract`（`src/*.ts`，CJS 输出）  | 侧车、Hub UI、桥接接入示例 |
| 适配器运行时接口（依赖 Node 流）           | `@agent-hub/server` 的 `src/adapters/types.ts` | 只有侧车                   |

contract 里每个类型都配一个同名 zod schema（如 `agentEventSchema`），REST 校验、tRPC 输入、导出 JSON Schema（`z.toJSONSchema`）共用。下面只写 TypeScript 形状。

## 2. 领域类型（`@agent-hub/contract`）

```ts
// contract/src/domain.ts
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AdapterKind = 'codex' | 'acp' | 'web';
export type TaskMode = 'read_only' | 'write';
export type WorkspaceMode = 'in_place' | 'worktree' | 'remote_branch';
export type TaskSource = 'ui' | 'bridge';

export type TaskStatus =
  | 'pending_confirmation'
  | 'queued'
  | 'preparing'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type TurnStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

/** 归一后的轮结束原因；各协议的映射见适配器分册。 */
export type StopReason =
  | 'end_turn'
  | 'cancelled'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'error';

export type ApprovalKind =
  | 'command'
  | 'file_change'
  | 'permission'
  | 'network'
  | 'mcp_tool'
  | 'user_input'
  | 'other';

/** Hub 只提供这四种决定；“永久允许 / 永久拒绝”一类会写进 Agent 自身配置的选项不暴露。 */
export type ApprovalDecision = 'allow_once' | 'allow_for_session' | 'reject' | 'cancel_turn';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
export type DecidedBy = 'ui' | 'bridge' | 'policy' | 'system';

export type ToolKind =
  | 'command'
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'fetch'
  | 'think'
  | 'mcp'
  | 'web'
  | 'other';

export interface PlanEntry {
  step: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface UsageInfo {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  contextWindow?: number;
  contextUsed?: number;
}

export interface DiffFileStat {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';
  insertions: number;
  deletions: number;
}

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: DiffFileStat[];
}
```

## 3. 统一事件

适配器只产出 `AgentEvent`；`CoreEvent` 由核心产出。两者都装进带 `seq` 的信封里落库、推送。桥接方和 Hub UI 看到的是同一套事件。

```ts
// contract/src/events.ts
import type {
  ApprovalDecision,
  ApprovalKind,
  DecidedBy,
  DiffFileStat,
  DiffStats,
  JsonValue,
  PlanEntry,
  StopReason,
  TaskStatus,
  ToolKind,
  UsageInfo,
} from './domain';
import type { AgentError } from './errors';

export interface ApprovalRequest {
  /** Hub 生成的 ULID；与 Agent 协议里的请求 id 无关。 */
  approvalId: string;
  kind: ApprovalKind;
  /** 一句话中文标题，例如“执行命令”“修改 3 个文件”。 */
  title: string;
  command?: string;
  cwd?: string;
  paths?: string[];
  /** Agent 给出的理由。 */
  reason?: string;
  /** 本次请求可选的决定；界面只渲染这里列出的按钮。 */
  decisions: ApprovalDecision[];
  /** 协议原始字段（脱敏后），供详情面板展示。 */
  detail?: JsonValue;
}

export type AgentEvent =
  | {
      type: 'session.started';
      nativeSessionId: string;
      model?: string;
      reasoningEffort?: string;
      userVisible?: boolean;
    }
  | { type: 'turn.started'; nativeTurnId?: string }
  | { type: 'message.delta'; itemId: string; text: string }
  | { type: 'message.completed'; itemId: string; text: string }
  | { type: 'reasoning.delta'; itemId: string; text: string }
  | { type: 'reasoning.completed'; itemId: string; text: string }
  | { type: 'plan.updated'; entries: PlanEntry[]; explanation?: string }
  | {
      type: 'tool.started';
      itemId: string;
      toolKind: ToolKind;
      title: string;
      command?: string;
      cwd?: string;
      paths?: string[];
    }
  | {
      type: 'tool.output';
      itemId: string;
      stream: 'stdout' | 'stderr' | 'text';
      text: string;
      truncated?: boolean;
    }
  | {
      type: 'tool.completed';
      itemId: string;
      status: 'completed' | 'failed' | 'declined';
      exitCode?: number;
      durationMs?: number;
    }
  /** Agent 自己报告的变更，实时展示用；权威 diff 由核心在轮结束时用 git 计算。 */
  | { type: 'diff.reported'; files: DiffFileStat[]; patch?: string }
  | { type: 'approval.requested'; approval: ApprovalRequest }
  /** Agent 侧撤回了请求（例如 Codex 的 serverRequest/resolved 在轮结束时清理）。 */
  | { type: 'approval.withdrawn'; approvalId: string; reason: string }
  | { type: 'usage.updated'; usage: UsageInfo }
  | { type: 'config.updated'; model?: string; reasoningEffort?: string; agentMode?: string }
  /** 网页 Agent 的远端进展：会话链接、分支、最新提交。 */
  | {
      type: 'remote.updated';
      url?: string;
      branch?: string;
      headCommit?: string;
      screenshotPath?: string;
    }
  | { type: 'notice'; level: 'info' | 'warning'; message: string }
  | { type: 'error'; error: AgentError }
  | { type: 'agent.exited'; exitCode: number | null; signal: string | null };

export type CoreEvent =
  | { type: 'task.status_changed'; from: TaskStatus; to: TaskStatus; reason?: string }
  | { type: 'turn.completed'; turnIndex: number; stopReason: StopReason; error?: AgentError }
  | {
      type: 'approval.resolved';
      approvalId: string;
      decision: ApprovalDecision;
      decidedBy: DecidedBy;
    }
  | {
      type: 'diff.snapshot';
      snapshotId: string;
      turnIndex: number;
      stats: DiffStats;
      truncated: boolean;
    };

export type HubEvent = AgentEvent | CoreEvent;

export interface HubEventEnvelope {
  taskId: string;
  /** 每个任务从 1 开始严格递增，断线续订用。 */
  seq: number;
  turnId: string | null;
  /** ISO 8601，UTC。 */
  ts: string;
  event: HubEvent;
}
```

约定：

- `itemId` 在同一任务内唯一；Codex 用协议的 item id，ACP 用 `toolCallId` 或适配器生成的消息 id。
- 一个 item 的事件顺序必须是 `*.started` / `*.delta`…… / `*.completed`；适配器负责补齐（例如 ACP 没有显式“消息结束”，在轮结束时补发 `message.completed`）。
- 适配器遇到不认识的协议通知：写 transcript，**不**产出事件，不报错（协议会不断加新通知）。
- `notice` 用于“Agent 切换了模型”“只读任务修改了工作区”等需要人看到但不影响流程的情况。

## 4. 错误码

```ts
// contract/src/errors.ts
import type { JsonValue } from './domain';

export type AgentErrorCode =
  | 'AGENT_BINARY_NOT_FOUND'
  | 'AGENT_SPAWN_FAILED'
  | 'AGENT_HANDSHAKE_TIMEOUT'
  | 'AGENT_PROTOCOL_ERROR'
  | 'AGENT_PROTOCOL_UNSUPPORTED'
  | 'AGENT_CRASHED'
  | 'AGENT_AUTH_REQUIRED'
  | 'AGENT_USAGE_LIMIT'
  | 'AGENT_CONTEXT_EXCEEDED'
  | 'AGENT_UPSTREAM_ERROR'
  | 'AGENT_SANDBOX_ERROR'
  | 'MODEL_NOT_SUPPORTED'
  | 'SESSION_NOT_RESUMABLE'
  | 'WEB_LOGIN_REQUIRED'
  | 'WEB_DOM_DRIFT'
  | 'WEB_TIMEOUT'
  | 'WORKSPACE_SETUP_FAILED'
  | 'WORKSPACE_DIRTY'
  | 'GIT_PUSH_BLOCKED'
  | 'INTERNAL';

export interface AgentError {
  code: AgentErrorCode;
  /** 给人看的中文说明，不含凭据与完整提示词。 */
  message: string;
  /** 用户不改任何东西、直接重试有没有可能成功。 */
  retryable: boolean;
  detail?: JsonValue;
}
```

API 层的错误码（`TASK_NOT_FOUND`、`TASK_BUSY` 等）另见 [local-api.md](local-api.md) §7，两套码不混用：`AgentError` 只出现在事件和 `Task.lastError` 里。

## 5. 能力与模型

```ts
// contract/src/capabilities.ts
import type { AdapterKind, ApprovalKind, WorkspaceMode } from './domain';
import type { AgentErrorCode } from './errors';

export interface ReasoningEffortOption {
  /** 原样传给 Agent 的值，例如 Codex 的 "medium"。 */
  id: string;
  /** 中文标签，例如“中”。 */
  label: string;
  description?: string;
}

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  /** 空数组表示该模型不支持选择推理档位。 */
  reasoningEfforts: ReasoningEffortOption[];
  defaultReasoningEffort?: string;
}

/** ACP 的会话模式（如 ask / code），Codex 没有。 */
export interface AgentModeOption {
  id: string;
  label: string;
  description?: string;
}

export interface AgentCapabilities {
  kind: AdapterKind;
  models: ModelOption[];
  /** static：配置写死；probe：启动时探测；session：只能在会话建立后得知。 */
  modelsSource: 'static' | 'probe' | 'session';
  modes: AgentModeOption[];
  /** Agent 自带、Hub 可以要求开启的沙箱（Codex 有，ACP 没有）。 */
  enforcesSandbox: boolean;
  /** 进程重启后能否恢复原生会话。 */
  supportsResume: boolean;
  supportsSetModelMidSession: boolean;
  supportsImages: boolean;
  /** Codex threadSource "user"：会话能否出现在 Agent 自己的客户端里。 */
  supportsUserVisibleSessions: boolean;
  approvalKinds: ApprovalKind[];
  workspaceModes: WorkspaceMode[];
  /** 抓取时间，界面显示“x 分钟前更新”。 */
  fetchedAt: string;
}

export type AgentHealth =
  | { status: 'checking' }
  | { status: 'ready'; version?: string; executablePath?: string }
  | { status: 'auth_required'; message: string; version?: string; executablePath?: string }
  | { status: 'unavailable'; code: AgentErrorCode; message: string }
  | { status: 'disabled' };
```

推理档位的中文标签统一由 contract 里的 `reasoningEffortLabel(id)` 给出：`none` 关闭、`minimal` 最低、`low` 低、`medium` 中、`high` 高、`xhigh` 极高；未知值原样显示。

## 6. 运行时接口（`@agent-hub/server`）

```ts
// server/src/adapters/types.ts
import type { Readable, Writable } from 'node:stream';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentHealth,
  AdapterKind,
  ApprovalDecision,
  StopReason,
  TaskMode,
  UsageInfo,
  AgentError,
} from '@agent-hub/contract';

/** config.json 里 agents[] 的公共字段；各适配器在此基础上扩展。 */
export interface AgentProfileConfig {
  id: string;
  kind: AdapterKind;
  displayName?: string;
  enabled?: boolean;
  maxConcurrent?: number;
  defaults?: { model?: string; reasoningEffort?: string; agentMode?: string };
}

export interface RemoteWorkspace {
  /** git remote 名，必须在 security.allowedPushRemotes 里。 */
  remote: string;
  branch: string;
  baseCommit: string;
  /** 去掉 userinfo 后的仓库地址，给网页 Agent 填表用。 */
  repoUrl: string;
}

export interface StartSessionParams {
  taskId: string;
  /** 绝对路径；remote_branch 模式下是本地镜像 worktree。 */
  cwd: string;
  mode: TaskMode;
  /** 可写任务为 [cwd]，只读任务为空。 */
  writableRoots: string[];
  model?: string;
  reasoningEffort?: string;
  agentMode?: string;
  /** Codex threadSource "user"；其他适配器忽略。 */
  userVisible: boolean;
  /** 已清洗、已注入推送守卫的环境变量（见 security.md §3.1、§4.2）。适配器不得自行读取 process.env。 */
  env: Record<string, string>;
  remote?: RemoteWorkspace;
  /** 有值时恢复原生会话而不是新建。 */
  resumeNativeSessionId?: string;
  signal: AbortSignal;
}

export type PromptAttachment =
  | { type: 'file'; path: string }
  | { type: 'image'; path: string; mimeType: string };

export interface PromptInput {
  turnId: string;
  text: string;
  attachments?: PromptAttachment[];
}

export interface TurnResult {
  stopReason: StopReason;
  finalMessage?: string;
  usage?: UsageInfo;
  error?: AgentError;
}

export interface AgentEventSink {
  emit(event: AgentEvent): void;
  /** 原始协议帧，写 transcript；由核心统一脱敏。 */
  rawFrame(direction: 'in' | 'out', frame: unknown): void;
}

export interface AgentSession {
  readonly nativeSessionId: string;
  /** 发出提示词；本轮结束（含取消、失败）时 resolve，不因 Agent 报错而 reject。 */
  prompt(input: PromptInput): Promise<TurnResult>;
  /** 协议级中断本轮；幂等。 */
  cancelTurn(): Promise<void>;
  /** 把人的决定交回 Agent；approvalId 不存在或已决定时抛 ApprovalNotPendingError。 */
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<void>;
  setModel?(model: string, reasoningEffort?: string): Promise<void>;
  setAgentMode?(modeId: string): Promise<void>;
  /** 释放会话占用的资源；ACP 会结束该任务的进程组。幂等。 */
  dispose(reason: 'completed' | 'cancelled' | 'shutdown' | 'idle' | 'crashed'): Promise<void>;
}

export interface AgentAdapter {
  readonly profile: AgentProfileConfig;
  init(): Promise<void>;
  health(): Promise<AgentHealth>;
  capabilities(options?: { refresh?: boolean }): Promise<AgentCapabilities>;
  startSession(params: StartSessionParams, sink: AgentEventSink): Promise<AgentSession>;
  /** 侧车停机时调用：中断全部会话、结束子进程。 */
  shutdown(): Promise<void>;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** 用于日志与孤儿进程识别。 */
  label: string;
}

export interface ManagedProcess {
  readonly pid: number;
  /** 以 detached 启动，pgid 等于 pid；结束时对整个进程组发信号。 */
  readonly pgid: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly exited: Promise<{ exitCode: number | null; signal: string | null }>;
  /** 关闭 stdin → 等 graceMs → SIGTERM 进程组 → 再等 graceMs → SIGKILL 进程组。 */
  terminate(options?: { graceMs?: number }): Promise<void>;
}

export interface AdapterDeps {
  spawn(spec: SpawnSpec): Promise<ManagedProcess>;
  /** 按登录 shell PATH 把命令名解析成绝对路径，找不到返回 null。 */
  resolveExecutable(command: string): Promise<string | null>;
  logger: {
    debug(msg: string, meta?: object): void;
    warn(msg: string, meta?: object): void;
    error(msg: string, meta?: object): void;
  };
  paths: { home: string; probeDir: string };
  now(): Date;
}

export interface AdapterFactory<C extends AgentProfileConfig = AgentProfileConfig> {
  readonly kind: AdapterKind;
  /** 校验 config.json 里该类适配器的配置项（zod schema 的 parse 函数）。 */
  parseConfig(raw: unknown): C;
  create(config: C, deps: AdapterDeps): AgentAdapter;
}
```

### 6.1 实现规则

1. **不碰数据库、不读 `process.env`、不自己选工作目录**：需要的东西都从参数和 `AdapterDeps` 拿，这样才能用假依赖做单测。
2. **`prompt()` 不因 Agent 业务错误而 reject**：上游限流、上下文超长、Agent 崩溃都映射成 `TurnResult.error`，只有调用方的编程错误才抛异常。
3. **审批必须有结局**：适配器内部维护 `approvalId → 协议请求` 的表；轮结束、取消、进程退出时，表里剩下的每一项都要按协议回复“取消”（进程已退出则直接丢弃）并产出 `approval.withdrawn`。
4. **超时**：握手 30 秒、普通请求 60 秒、`prompt` 不设总超时（由人取消）；超时映射为 `AGENT_HANDSHAKE_TIMEOUT` / `AGENT_PROTOCOL_ERROR`。
5. **增量不合并**：适配器按协议原样产出 delta，合并由 `EventStore` 统一做（architecture.md §5）。
6. **单测要求**：每个适配器都有基于“假 Agent”的协议级测试，覆盖 [testing.md](testing.md) §4 错误路径矩阵里对应的行。

## 7. 审批归一

| Hub 决定            | Codex 命令执行 / 文件修改 | Codex `item/permissions/requestApproval` | ACP `session/request_permission`                                  |
| ------------------- | ------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `allow_once`        | `accept`                  | 授予所请求的权限，`scope: "turn"`        | 选 `kind: allow_once` 的选项                                      |
| `allow_for_session` | `acceptForSession`        | 授予所请求的权限，`scope: "session"`     | 选 `kind: allow_always` 的选项（界面注明“由 Agent 决定记住多久”） |
| `reject`            | `decline`                 | 授予空集合                               | 选 `kind: reject_once` 的选项                                     |
| `cancel_turn`       | `cancel`                  | 授予空集合，并中断本轮                   | 回复 `outcome: cancelled`，并发送 `session/cancel`                |

- Hub **不提供**会修改 Agent 持久配置的决定：Codex 的 `acceptWithExecpolicyAmendment`、`applyNetworkPolicyAmendment`，ACP 的 `reject_always`。
- 对方没给某类选项时，`ApprovalRequest.decisions` 里就不列对应决定。ACP 必须至少能“拒绝”：没有 `reject_once` 时只给 `cancel_turn`。
- `kind` 归类：Codex 命令执行 → `command`（`networkApprovalContext` 非空时 → `network`），文件修改 → `file_change`，权限申请 → `permission`，`item/tool/requestUserInput` → `user_input`，MCP elicitation → `mcp_tool`；ACP 按 `toolCall.kind`：`execute` → `command`，`edit` / `delete` / `move` → `file_change`，`fetch` → `network`，其余 → `other`。
- **桥接方默认不能审批**（scope `approvals:decide` 默认不发），见 [security.md](security.md) §4.3。
- 不做自动批准。`DecidedBy = 'policy'` 留作以后的规则引擎扩展点，M1–M5 都不产生。

## 8. 新增一个 Agent

1. **说 ACP 的 Agent**（大多数情况）：只在 `config.json` 加一项 `kind: "acp"`。有协议怪癖时在 `server/src/adapters/acp/profiles/` 加一个 profile（见 [adapter-acp.md](adapter-acp.md) §6），**不要**为单个 Agent 复制一份 AcpAdapter。
2. **全新协议**：实现 `AdapterFactory`，在 `AdapterRegistry` 注册；写一个假 Agent 覆盖错误路径矩阵；新增一篇 `docs/adapter-<name>.md`，结构参照 Codex 那篇（握手、会话、轮、事件映射、审批映射、取消、恢复、兼容表）。
3. **网页 Agent**：实现 `WebAgentDriver`（[web-agent.md](web-agent.md) §4），不新增适配器类型。
4. 三种情况都要更新 README §3 的场景（如有新场景）和 [milestones.md](milestones.md) 的任务卡。
