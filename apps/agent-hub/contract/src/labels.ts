import {
  ADAPTER_KINDS,
  APPROVAL_DECISIONS,
  APPROVAL_KINDS,
  APPROVAL_STATUSES,
  DECIDERS,
  SCOPES,
  STOP_REASONS,
  TASK_MODES,
  TASK_SOURCES,
  TASK_STATUSES,
  TOOL_KINDS,
  TURN_STATUSES,
  WORKSPACE_KINDS,
  type AdapterKind,
  type ApprovalDecision,
  type ApprovalKind,
  type ApprovalStatus,
  type DecidedBy,
  type Scope,
  type StopReason,
  type TaskMode,
  type TaskSource,
  type TaskStatus,
  type ToolKind,
  type TurnStatus,
  type WorkspaceKind,
} from './domain';

export const TASK_STATUS_LABELS = {
  queued: '排队中',
  preparing: '准备中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
} satisfies Record<TaskStatus, string>;

export const TURN_STATUS_LABELS = {
  pending: '未开始',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
} satisfies Record<TurnStatus, string>;

export const TASK_MODE_LABELS = {
  read_only: '只读',
  write: '可写',
} satisfies Record<TaskMode, string>;

export const WORKSPACE_KIND_LABELS = {
  in_place: '原目录',
  worktree: 'worktree',
  remote_branch: '远端分支',
} satisfies Record<WorkspaceKind, string>;

export const TASK_SOURCE_LABELS = {
  ui: '界面',
  bridge: '本地郎',
} satisfies Record<TaskSource, string>;

export const APPROVAL_KIND_LABELS = {
  command: '命令',
  file_change: '改文件',
  network: '联网',
  other: '其他',
} satisfies Record<ApprovalKind, string>;

export const APPROVAL_DECISION_LABELS = {
  allow_once: '允许一次',
  allow_for_session: '本会话允许',
  reject: '拒绝',
  cancel_turn: '拒绝并停止本轮',
} satisfies Record<ApprovalDecision, string>;

export const APPROVAL_STATUS_LABELS = {
  pending: '待审批',
  approved: '已允许',
  rejected: '已拒绝',
  expired: '已超时',
  withdrawn: '已撤回',
} satisfies Record<ApprovalStatus, string>;

export const DECIDER_LABELS = {
  ui: '你',
  bridge: '本地郎',
  system: '系统',
} satisfies Record<DecidedBy, string>;

export const STOP_REASON_LABELS = {
  end_turn: '正常结束',
  max_tokens: '达到长度上限',
  max_turn_requests: '达到步数上限',
  refusal: '拒绝回答',
  cancelled: '已停止',
  error: '出错',
} satisfies Record<StopReason, string>;

export const ADAPTER_KIND_LABELS = {
  codex: 'Codex',
  acp: 'ACP',
  web: '网页',
} satisfies Record<AdapterKind, string>;

export const TOOL_KIND_LABELS = {
  command: '命令',
  read: '读取',
  edit: '编辑',
  delete: '删除',
  move: '移动',
  search: '搜索',
  fetch: '联网',
  think: '推理',
  mcp: 'MCP',
  other: '其他',
} satisfies Record<ToolKind, string>;

/** domain.ts 没有单独的常量数组，标签表仍要覆盖 hub-ui §2.1。 */
export const DIFF_FILE_STATUSES: readonly ['added', 'modified', 'deleted', 'renamed'] = [
  'added',
  'modified',
  'deleted',
  'renamed',
];
export type DiffFileStatus = (typeof DIFF_FILE_STATUSES)[number];

export const DIFF_FILE_STATUS_LABELS = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
} satisfies Record<DiffFileStatus, string>;

export const SCOPE_LABELS = {
  'tasks:read': '读取任务与 diff',
  'tasks:write': '派发和追问',
  'approvals:decide': '代替你批准或拒绝命令',
} satisfies Record<Scope, string>;

const REASONING_EFFORT_LABELS: Record<string, string> = {
  default: '默认',
  none: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
};

/** 未知档位原样显示。 */
export function reasoningEffortLabel(id: string): string {
  return REASONING_EFFORT_LABELS[id] ?? id;
}

export function taskStatusLabel(status: string): string {
  return labelFrom(TASK_STATUSES, TASK_STATUS_LABELS, status);
}

export function turnStatusLabel(status: string): string {
  return labelFrom(TURN_STATUSES, TURN_STATUS_LABELS, status);
}

export function taskModeLabel(mode: string): string {
  return labelFrom(TASK_MODES, TASK_MODE_LABELS, mode);
}

export function workspaceKindLabel(kind: string): string {
  return labelFrom(WORKSPACE_KINDS, WORKSPACE_KIND_LABELS, kind);
}

export function taskSourceLabel(source: string): string {
  return labelFrom(TASK_SOURCES, TASK_SOURCE_LABELS, source);
}

export function approvalKindLabel(kind: string): string {
  return labelFrom(APPROVAL_KINDS, APPROVAL_KIND_LABELS, kind);
}

export function approvalDecisionLabel(decision: string): string {
  return labelFrom(APPROVAL_DECISIONS, APPROVAL_DECISION_LABELS, decision);
}

export function approvalStatusLabel(status: string): string {
  return labelFrom(APPROVAL_STATUSES, APPROVAL_STATUS_LABELS, status);
}

export function deciderLabel(decider: string): string {
  return labelFrom(DECIDERS, DECIDER_LABELS, decider);
}

export function stopReasonLabel(reason: string): string {
  return labelFrom(STOP_REASONS, STOP_REASON_LABELS, reason);
}

export function adapterKindLabel(kind: string): string {
  return labelFrom(ADAPTER_KINDS, ADAPTER_KIND_LABELS, kind);
}

export function toolKindLabel(kind: string): string {
  return labelFrom(TOOL_KINDS, TOOL_KIND_LABELS, kind);
}

export function diffFileStatusLabel(status: string): string {
  return labelFrom(DIFF_FILE_STATUSES, DIFF_FILE_STATUS_LABELS, status);
}

export function scopeLabel(scope: string): string {
  return labelFrom(SCOPES, SCOPE_LABELS, scope);
}

function labelFrom<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
  value: string,
): string {
  for (const candidate of values) {
    if (candidate === value) return labels[candidate];
  }
  return value;
}
