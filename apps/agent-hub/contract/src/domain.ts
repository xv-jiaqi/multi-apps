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
