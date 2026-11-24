import {
  reasoningEffortLabel,
  type AgentError,
  type AgentEvent,
  type ApprovalDecision,
  type ModelOption,
  type TaskMode,
  type UsageInfo,
} from '@agent-hub/contract';
import { agentError, toJsonValue, type ApprovalRequestInput, type TurnResult } from '../types';
import type {
  ApprovalDecisionWire,
  CodexErrorInfo,
  CodexModel,
  CodexTurn,
  CommandExecutionRequestApprovalParams,
  FileChangeRequestApprovalParams,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  SandboxMode,
  SandboxPolicy,
  ThreadItem,
  ThreadTokenUsageUpdatedNotification,
  TurnError,
  TurnPlanUpdatedNotification,
} from './protocol';

export const CODEX_DEVELOPER_INSTRUCTIONS =
  '你在 Agent Hub 派发的任务中运行。不要执行 git push，不要修改 git remote 配置，' +
  '不要读取或输出凭据文件（例如 ~/.ssh、~/.netrc、.env）。';

export const ALL_DECISIONS: ApprovalDecision[] = [
  'allow_once',
  'allow_for_session',
  'reject',
  'cancel_turn',
];

/** "agent_hub/0.164.0 (Mac OS 15.1.0; arm64) …" → "0.164.0"。 */
export function parseCodexVersion(userAgent: string): string | null {
  return /^[^/\s]+\/(\d+\.\d+\.\d+[^\s(]*)/.exec(userAgent)?.[1] ?? null;
}

export function sandboxFor(
  mode: TaskMode,
  cwd: string,
): { sandbox: SandboxMode; sandboxPolicy: SandboxPolicy } {
  if (mode === 'read_only') {
    return {
      sandbox: 'read-only',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    };
  }
  return {
    sandbox: 'workspace-write',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [cwd],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  };
}

/** 隐藏的模型不列出；id 用 model 字段（turn/start.model 接受的值）。 */
export function normalizeCodexModels(models: CodexModel[]): ModelOption[] {
  const seen = new Set<string>();
  const options: ModelOption[] = [];
  for (const m of models) {
    if (m.hidden || seen.has(m.model)) continue;
    seen.add(m.model);
    options.push({
      id: m.model,
      label: m.displayName || m.model,
      description: m.description || undefined,
      isDefault: m.isDefault,
      reasoningEfforts: m.supportedReasoningEfforts.map((e) => ({
        id: e.reasoningEffort,
        label: reasoningEffortLabel(e.reasoningEffort),
        description: e.description || undefined,
      })),
      defaultReasoningEffort: m.defaultReasoningEffort || null,
    });
  }
  return options;
}

/**
 * turn/start 的 model / effort：明确传值，避免上一轮的覆盖残留（§4.3）。
 * 用户没选时用默认模型（isDefault）及其默认档位；模型列表还没拿到时不传。
 */
export function resolveTurnModel(
  models: ModelOption[],
  model: string | null,
  effort: string | null,
): { model?: string; effort?: string } {
  const chosen = model ?? models.find((m) => m.isDefault)?.id;
  if (!chosen) return effort ? { effort } : {};
  const option = models.find((m) => m.id === chosen);
  const resolvedEffort = effort ?? option?.defaultReasoningEffort ?? undefined;
  return resolvedEffort ? { model: chosen, effort: resolvedEffort } : { model: chosen };
}

export function mapItemStarted(item: ThreadItem): AgentEvent | null {
  switch (item.type) {
    case 'commandExecution':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'command',
        title: '执行命令',
        command: item.command,
        cwd: item.cwd,
      };
    case 'fileChange':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'edit',
        title: `修改 ${item.changes.length} 个文件`,
        paths: item.changes.map((c) => c.path),
      };
    case 'mcpToolCall':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'mcp',
        title: `MCP：${item.server}/${item.tool}`,
      };
    case 'dynamicToolCall':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'other',
        title: `工具：${item.tool}`,
      };
    case 'webSearch':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'fetch',
        title: item.query ? `网页搜索：${item.query}` : '网页搜索',
      };
    case 'imageView':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'read',
        title: '查看图片',
        paths: [item.path],
      };
    default:
      return null;
  }
}

export function mapItemCompleted(item: ThreadItem): AgentEvent | null {
  switch (item.type) {
    case 'agentMessage':
      return { type: 'message.completed', itemId: item.id, text: item.text };
    case 'reasoning': {
      const text = item.summary.join('\n\n');
      return text ? { type: 'reasoning.completed', itemId: item.id, text } : null;
    }
    case 'commandExecution':
      return {
        type: 'tool.completed',
        itemId: item.id,
        status: toolStatus(item.status),
        ...(item.exitCode === null ? {} : { exitCode: item.exitCode }),
        ...(item.durationMs === null ? {} : { durationMs: item.durationMs }),
      };
    case 'fileChange':
      return {
        type: 'tool.completed',
        itemId: item.id,
        status: toolStatus(item.status),
      };
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return {
        type: 'tool.completed',
        itemId: item.id,
        status: item.status === 'failed' ? 'failed' : 'completed',
        ...(item.durationMs === null ? {} : { durationMs: item.durationMs }),
      };
    case 'webSearch':
    case 'imageView':
      return { type: 'tool.completed', itemId: item.id, status: 'completed' };
    case 'contextCompaction':
      return {
        type: 'notice',
        level: 'info',
        code: 'CONTEXT_COMPACTED',
        message: 'Codex 压缩了会话上下文',
      };
    default:
      return null;
  }
}

function toolStatus(status: string): 'completed' | 'failed' | 'declined' {
  return status === 'failed' ? 'failed' : status === 'declined' ? 'declined' : 'completed';
}

export function mapPlan(n: TurnPlanUpdatedNotification): AgentEvent {
  return {
    type: 'plan.updated',
    explanation: n.explanation,
    entries: n.plan.map((p) => ({
      step: p.step,
      status: p.status === 'inProgress' ? 'in_progress' : p.status,
    })),
  };
}

/** Codex 报的是整个 thread 的累计用量。 */
export function mapTokenUsage(n: ThreadTokenUsageUpdatedNotification): UsageInfo {
  const t = n.tokenUsage.total;
  const usage: UsageInfo = {
    inputTokens: t.inputTokens,
    cachedInputTokens: t.cachedInputTokens,
    outputTokens: t.outputTokens,
    reasoningOutputTokens: t.reasoningOutputTokens,
    totalTokens: t.totalTokens,
  };
  if (n.tokenUsage.modelContextWindow !== null)
    usage.contextWindow = n.tokenUsage.modelContextWindow;
  return usage;
}

function errorInfoKey(info: CodexErrorInfo | null): {
  key: string | null;
  httpStatus: number | null;
} {
  if (info === null) return { key: null, httpStatus: null };
  if (typeof info === 'string') return { key: info, httpStatus: null };
  const key = Object.keys(info)[0] ?? null;
  const inner = key ? (info as Record<string, unknown>)[key] : null;
  const status =
    inner && typeof inner === 'object'
      ? (inner as { httpStatusCode?: unknown }).httpStatusCode
      : null;
  return { key, httpStatus: typeof status === 'number' ? status : null };
}

/** 鉴权失败（401）：重试也没用，适配器应立即中断本轮（§5.3）。 */
export function isAuthFailure(error: TurnError): boolean {
  const { key, httpStatus } = errorInfoKey(error.codexErrorInfo);
  return key === 'unauthorized' || httpStatus === 401;
}

const RETRYABLE_UPSTREAM = new Set([
  'serverOverloaded',
  'internalServerError',
  'flexUnavailable',
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
]);

export function mapTurnError(error: TurnError | null): AgentError {
  if (!error) return agentError('AGENT_UPSTREAM_ERROR', 'Codex 报告本轮失败，没有给出原因', true);
  const { key, httpStatus } = errorInfoKey(error.codexErrorInfo);
  const detail = toJsonValue({
    codexErrorInfo: error.codexErrorInfo,
    additionalDetails: error.additionalDetails,
  });
  const msg = `Codex：${error.message}`;
  if (key === 'unauthorized' || httpStatus === 401) {
    return agentError(
      'AGENT_AUTH_REQUIRED',
      'Codex 未登录或登录已过期：请在 ChatGPT 应用或终端里执行 codex login 后重试',
      false,
      detail,
    );
  }
  if (
    key === 'usageLimitExceeded' ||
    key === 'rateLimitExceeded' ||
    key === 'sessionBudgetExceeded' ||
    httpStatus === 429
  ) {
    return agentError('AGENT_RATE_LIMITED', msg, true, detail);
  }
  if (key === 'contextWindowExceeded')
    return agentError('AGENT_CONTEXT_EXCEEDED', msg, false, detail);
  if (key === 'sandboxError') return agentError('AGENT_SANDBOX_ERROR', msg, false, detail);
  return agentError(
    'AGENT_UPSTREAM_ERROR',
    msg,
    key !== null && RETRYABLE_UPSTREAM.has(key),
    detail,
  );
}

/**
 * turn/completed → TurnResult。fatal 是本轮记下的致命错误（willRetry 为 false 的 error 通知，
 * 或适配器因鉴权失败主动中断）；有 fatal 时即使 status 是 interrupted 也按失败处理。
 */
export function mapTurnCompleted(turn: CodexTurn, fatal: AgentError | null): TurnResult {
  if (fatal && turn.status !== 'completed') {
    return { stopReason: 'error', error: fatal, nativeTurnId: turn.id };
  }
  switch (turn.status) {
    case 'completed':
      return { stopReason: 'end_turn', nativeTurnId: turn.id };
    case 'interrupted':
      return { stopReason: 'cancelled', nativeTurnId: turn.id };
    default:
      return {
        stopReason: 'error',
        error: mapTurnError(turn.error),
        nativeTurnId: turn.id,
      };
  }
}

export function decisionToWire(decision: ApprovalDecision): ApprovalDecisionWire {
  switch (decision) {
    case 'allow_once':
      return 'accept';
    case 'allow_for_session':
      return 'acceptForSession';
    case 'reject':
      return 'decline';
    case 'cancel_turn':
      return 'cancel';
  }
}

export function approvalForCommand(p: CommandExecutionRequestApprovalParams): ApprovalRequestInput {
  const network = p.networkApprovalContext ?? null;
  const input: ApprovalRequestInput = {
    kind: network ? 'network' : 'command',
    title: network
      ? `访问网络：${network.host}`
      : p.kind === 'writeStdin'
        ? '向进程写入输入'
        : '执行命令',
    options: ALL_DECISIONS,
    detail: toJsonValue(p),
  };
  if (p.command) input.command = p.command;
  if (p.cwd) input.cwd = p.cwd;
  if (p.reason) input.reason = p.reason;
  return input;
}

/** paths 取自同一 itemId 的 fileChange item（item/started 时记下）。 */
export function approvalForFileChange(
  p: FileChangeRequestApprovalParams,
  paths: string[] | undefined,
): ApprovalRequestInput {
  const input: ApprovalRequestInput = {
    kind: 'file_change',
    title: p.grantRoot
      ? `授予目录写权限：${p.grantRoot}`
      : paths?.length
        ? `修改 ${paths.length} 个文件`
        : '修改文件',
    options: ALL_DECISIONS,
    detail: toJsonValue(p),
  };
  if (paths?.length) input.paths = paths;
  if (p.reason) input.reason = p.reason;
  return input;
}

export function approvalForPermissions(p: PermissionsRequestApprovalParams): ApprovalRequestInput {
  const fs = p.permissions.fileSystem;
  const paths = [...(fs?.read ?? []), ...(fs?.write ?? [])];
  const input: ApprovalRequestInput = {
    kind: p.permissions.network?.enabled ? 'network' : 'other',
    title: p.permissions.network?.enabled ? '申请联网权限' : '申请额外的文件权限',
    cwd: p.cwd,
    options: ALL_DECISIONS,
    detail: toJsonValue(p),
  };
  if (paths.length) input.paths = paths;
  if (p.reason) input.reason = p.reason;
  return input;
}

export function permissionsResponse(
  p: PermissionsRequestApprovalParams,
  decision: ApprovalDecision,
): PermissionsRequestApprovalResponse {
  if (decision === 'reject' || decision === 'cancel_turn')
    return { permissions: {}, scope: 'turn' };
  const granted: PermissionsRequestApprovalResponse['permissions'] = {};
  if (p.permissions.network) granted.network = p.permissions.network;
  if (p.permissions.fileSystem) granted.fileSystem = p.permissions.fileSystem;
  return {
    permissions: granted,
    scope: decision === 'allow_for_session' ? 'session' : 'turn',
  };
}
