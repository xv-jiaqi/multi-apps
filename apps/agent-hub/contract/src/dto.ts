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
