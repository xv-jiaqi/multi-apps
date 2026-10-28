import {
  ADAPTER_KINDS,
  AGENT_ERROR_CODES,
  API_ERROR_STATUS,
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
  hubConfigSchema,
  type ApiErrorCode,
  type JsonValue,
} from '@agent-hub/contract';
import { z } from 'zod';

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const agentErrorSchema = z.object({
  code: z.enum(AGENT_ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  detail: jsonValueSchema.optional(),
});

const usageSchema = z.object({
  inputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  reasoningOutputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  contextWindow: z.number().optional(),
});

const diffFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  insertions: z.number(),
  deletions: z.number(),
  binary: z.boolean(),
});

const diffStatsSchema = z.object({
  filesChanged: z.number(),
  insertions: z.number(),
  deletions: z.number(),
  files: z.array(diffFileSchema),
});

export const taskDtoSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  title: z.string(),
  agentId: z.string(),
  adapterKind: z.enum(ADAPTER_KINDS),
  repoId: z.string(),
  repoPath: z.string(),
  source: z.enum(TASK_SOURCES),
  sourceTokenId: z.string().nullable(),
  externalRef: z.string().nullable(),
  mode: z.enum(TASK_MODES),
  workspace: z.enum(WORKSPACE_KINDS),
  workspacePath: z.string().nullable(),
  branch: z.string().nullable(),
  baseRef: z.string().nullable(),
  baseCommit: z.string().nullable(),
  model: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  userVisible: z.boolean(),
  nativeSessionId: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  pendingApprovals: z.number(),
  turnCount: z.number(),
  lastEventSeq: z.number(),
  lastError: agentErrorSchema.nullable(),
  readOnlyViolation: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  worktreeRemovedAt: z.string().nullable(),
});

export const turnDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  index: z.number(),
  prompt: z.string(),
  model: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  status: z.enum(TURN_STATUSES),
  stopReason: z.enum(STOP_REASONS).nullable(),
  error: agentErrorSchema.nullable(),
  nativeTurnId: z.string().nullable(),
  turnStats: diffStatsSchema.nullable(),
  taskStats: diffStatsSchema.nullable(),
  patchTruncated: z.boolean(),
  usage: usageSchema.nullable(),
  finalMessage: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

export const approvalDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  turnId: z.string(),
  kind: z.enum(APPROVAL_KINDS),
  title: z.string(),
  command: z.string().nullable(),
  cwd: z.string().nullable(),
  paths: z.array(z.string()).nullable(),
  reason: z.string().nullable(),
  detail: jsonValueSchema.nullable(),
  options: z.array(z.enum(APPROVAL_DECISIONS)),
  status: z.enum(APPROVAL_STATUSES),
  decision: z.enum(APPROVAL_DECISIONS).nullable(),
  decidedBy: z.enum(DECIDERS).nullable(),
  decidedByTokenId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  resolvedAt: z.string().nullable(),
});

export const taskDetailSchema = taskDtoSchema.extend({
  turns: z.array(turnDtoSchema),
  approvals: z.array(approvalDtoSchema),
});

const modelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean(),
  reasoningEfforts: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
    }),
  ),
  defaultReasoningEffort: z.string().nullable(),
});

const capabilitiesSchema = z.object({
  models: z.array(modelOptionSchema),
  modelsSource: z.enum(['agent', 'session', 'none']),
  sandbox: z.boolean(),
  resume: z.boolean(),
  userVisibleSessions: z.boolean(),
  workspaces: z.array(z.enum(WORKSPACE_KINDS)),
  fetchedAt: z.string(),
});

const healthSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('checking') }),
  z.object({
    status: z.literal('ready'),
    version: z.string().nullable(),
    versionVerified: z.boolean(),
    executablePath: z.string().nullable(),
  }),
  z.object({
    status: z.literal('auth_required'),
    message: z.string(),
    version: z.string().nullable(),
  }),
  z.object({
    status: z.literal('unavailable'),
    code: z.enum(AGENT_ERROR_CODES),
    message: z.string(),
  }),
  z.object({ status: z.literal('disabled') }),
]);

export const agentDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  kind: z.enum(ADAPTER_KINDS),
  profile: z.string().nullable(),
  enabled: z.boolean(),
  health: healthSchema,
  capabilities: capabilitiesSchema.nullable(),
  maxConcurrentTasks: z.number(),
  runningTasks: z.number(),
  queuedTasks: z.number(),
});

const remoteSchema = z.object({
  name: z.string(),
  fetchUrl: z.string().nullable(),
  pushUrl: z.string().nullable(),
});

export const repoInspectionSchema = z.object({
  ok: z.boolean(),
  problems: z.array(z.string()),
  topLevel: z.string().nullable(),
  currentBranch: z.string().nullable(),
  head: z.string().nullable(),
  dirty: z.boolean(),
  remotes: z.array(remoteSchema),
  originPushDisabled: z.boolean(),
  internalPushHost: z.string().nullable(),
});

export const repoDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  defaultBaseRef: z.string().nullable(),
  isDefault: z.boolean(),
  inspection: repoInspectionSchema,
});

const planEntrySchema = z.object({
  step: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
});

export const hubEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.started'),
    nativeSessionId: z.string(),
    model: z.string().nullable(),
    resumed: z.boolean(),
  }),
  z.object({ type: z.literal('message.delta'), itemId: z.string(), text: z.string() }),
  z.object({ type: z.literal('message.completed'), itemId: z.string(), text: z.string() }),
  z.object({ type: z.literal('reasoning.delta'), itemId: z.string(), text: z.string() }),
  z.object({ type: z.literal('reasoning.completed'), itemId: z.string(), text: z.string() }),
  z.object({
    type: z.literal('plan.updated'),
    entries: z.array(planEntrySchema),
    explanation: z.string().nullable(),
  }),
  z.object({
    type: z.literal('tool.started'),
    itemId: z.string(),
    toolKind: z.enum(TOOL_KINDS),
    title: z.string(),
    command: z.string().optional(),
    cwd: z.string().optional(),
    paths: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('tool.output.delta'),
    itemId: z.string(),
    text: z.string(),
    truncated: z.literal(true).optional(),
  }),
  z.object({
    type: z.literal('tool.completed'),
    itemId: z.string(),
    status: z.enum(['completed', 'failed', 'declined']),
    exitCode: z.number().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({ type: z.literal('usage.updated'), usage: usageSchema }),
  z.object({
    type: z.literal('remote.updated'),
    branch: z.string(),
    headCommit: z.string(),
    newCommits: z.number(),
  }),
  z.object({
    type: z.literal('notice'),
    level: z.enum(['info', 'warning', 'error']),
    code: z.string().optional(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('task.status'),
    from: z.enum(TASK_STATUSES),
    to: z.enum(TASK_STATUSES),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('turn.started'),
    turnId: z.string(),
    index: z.number(),
    prompt: z.string(),
    model: z.string().nullable(),
    reasoningEffort: z.string().nullable(),
  }),
  z.object({
    type: z.literal('turn.completed'),
    turnId: z.string(),
    index: z.number(),
    status: z.enum(TURN_STATUSES),
    stopReason: z.enum(STOP_REASONS),
    error: agentErrorSchema.optional(),
  }),
  z.object({ type: z.literal('approval.requested'), approval: approvalDtoSchema }),
  z.object({
    type: z.literal('approval.resolved'),
    approvalId: z.string(),
    status: z.enum(['approved', 'rejected', 'expired', 'withdrawn']),
    decision: z.enum(APPROVAL_DECISIONS).nullable(),
    decidedBy: z.enum(DECIDERS),
  }),
  z.object({
    type: z.literal('diff.updated'),
    turnId: z.string(),
    scope: z.enum(['turn_end', 'live']),
    task: diffStatsSchema,
    turn: diffStatsSchema,
    patchTruncated: z.boolean(),
  }),
]);

export const envelopeSchema = z.object({
  taskId: z.string(),
  seq: z.number(),
  turnId: z.string().nullable(),
  ts: z.string(),
  event: hubEventSchema,
});

export const itemsSchema = <S extends z.ZodType>(item: S) => z.object({ items: z.array(item) });

export const listTasksSchema = z.object({
  items: z.array(taskDtoSchema),
  nextCursor: z.string().nullable(),
});

export const taskWithTurnSchema = z.object({
  task: taskDtoSchema,
  turn: turnDtoSchema,
  replayed: z.boolean(),
});

export const healthResponseSchema = z.object({
  app: z.literal('agent-hub'),
  version: z.string(),
});

export const meResponseSchema = z.object({
  kind: z.enum(['ui', 'bridge']),
  tokenId: z.string().nullable(),
  scopes: z.array(z.enum(SCOPES)),
  admin: z.boolean(),
});

export const diffSchema = z.object({
  taskId: z.string(),
  scope: z.enum(['task', 'turn']),
  turnIndex: z.number(),
  live: z.boolean(),
  stats: diffStatsSchema,
  patch: z.string().nullable(),
  truncated: z.boolean(),
});

export const applyResponseSchema = z.object({
  branch: z.string(),
  commit: z.string().nullable(),
  merged: z.boolean(),
  mergeCommit: z.string().nullable(),
});

export const settingsResponseSchema = z.object({
  config: hubConfigSchema,
  restartRequired: z.boolean(),
  dataDir: z.string(),
  bridgeTokenFile: z.string(),
});

export const tokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.enum(SCOPES)),
  isDefault: z.boolean(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const createdTokenSchema = tokenSchema.extend({ token: z.string() });

export const auditSchema = z.object({
  id: z.number(),
  ts: z.string(),
  actor: z.string(),
  action: z.string(),
  taskId: z.string().nullable(),
  detail: jsonValueSchema.nullable(),
});

export const listAuditSchema = z.object({
  items: z.array(auditSchema),
  nextBefore: z.number().nullable(),
});

export const diagnosticsSchema = z.object({ file: z.string() });

export const listEventsSchema = z.object({
  events: z.array(envelopeSchema),
  lastSeq: z.number(),
  hasMore: z.boolean(),
});

export const waitResponseSchema = z.object({
  reached: z.boolean(),
  task: taskDtoSchema,
  lastSeq: z.number(),
});

export const taskResultSchema = z.object({
  taskId: z.string(),
  shortId: z.string(),
  status: z.enum(TASK_STATUSES),
  turn: z.object({
    index: z.number(),
    status: z.enum(TURN_STATUSES),
    stopReason: z.enum(STOP_REASONS).nullable(),
    error: agentErrorSchema.nullable(),
    finalMessage: z.string().nullable(),
    usage: usageSchema.nullable(),
  }),
  diff: z
    .object({
      turnIndex: z.number(),
      stats: diffStatsSchema,
      patchTruncated: z.boolean(),
    })
    .nullable(),
  pendingApprovals: z.number(),
  readOnlyViolation: z.boolean(),
  endedAt: z.string().nullable(),
});

const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: jsonValueSchema.optional(),
  }),
});

export function readApiErrorBody(
  body: unknown,
): { code: ApiErrorCode; message: string; details: JsonValue | null } | null {
  const parsed = apiErrorBodySchema.safeParse(body);
  if (!parsed.success) return null;
  if (!isApiErrorCode(parsed.data.error.code)) return null;
  return {
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    details: parsed.data.error.details ?? null,
  };
}

export function isApiErrorCode(code: string): code is ApiErrorCode {
  return Object.prototype.hasOwnProperty.call(API_ERROR_STATUS, code);
}

export const wsServerMessageSchema = z.union([
  z.object({
    op: z.literal('ready'),
    kind: z.enum(['ui', 'bridge']),
    scopes: z.array(z.string()),
    admin: z.boolean(),
  }),
  z.object({ op: z.literal('subscribed'), id: z.string() }),
  z.object({ op: z.literal('pong') }),
  z.object({ op: z.literal('task'), id: z.string(), task: taskDtoSchema }),
  z.object({ op: z.literal('approval'), id: z.string(), approval: approvalDtoSchema }),
  envelopeSchema.extend({ op: z.literal('event'), id: z.string() }),
  z.object({
    op: z.literal('error'),
    id: z.string().optional(),
    code: z.string(),
    message: z.string(),
  }),
]);
