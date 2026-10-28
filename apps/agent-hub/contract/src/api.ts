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
