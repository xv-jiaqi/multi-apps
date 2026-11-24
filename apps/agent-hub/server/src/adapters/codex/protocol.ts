/**
 * codex app-server 协议的手写子集（D33），按 codex-cli 0.164.0 生成的类型核对。
 * 只包含 Hub 发出的请求、Hub 处理的通知与服务端请求；字段名、取值与线上完全一致。
 * 线上的帧不带 "jsonrpc" 字段。
 */
import type { JsonValue } from '@agent-hub/contract';

export const CODEX_VERIFIED_VERSIONS = ['0.164.0'] as const;

/** Hub 只会发出这些方法（§2）；其余一律在发送前拒绝。 */
export const CODEX_CLIENT_METHODS = [
  'initialize',
  'initialized',
  'account/read',
  'model/list',
  'thread/start',
  'thread/resume',
  'thread/unsubscribe',
  'turn/start',
  'turn/interrupt',
] as const;
export type CodexClientMethod = (typeof CODEX_CLIENT_METHODS)[number];

// ---- 握手 ----

export interface InitializeParams {
  clientInfo: { name: string; title: string | null; version: string };
  capabilities: { experimentalApi: boolean; requestAttestation: boolean };
}

export interface InitializeResponse {
  /** 例如 "agent_hub/0.164.0 (Mac OS 15.1.0; arm64) …"；斜杠后的语义化版本就是 Codex 版本。 */
  userAgent: string;
  platformFamily: string;
  platformOs: string;
}

// ---- 账号与模型 ----

export interface GetAccountParams {
  refreshToken?: boolean;
}

export interface GetAccountResponse {
  account: { type: string } | null;
  requiresOpenaiAuth: boolean;
}

export interface ModelListParams {
  cursor?: string | null;
  includeHidden?: boolean | null;
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string;
}

export interface ModelListResponse {
  data: CodexModel[];
  nextCursor: string | null;
}

// ---- 会话 ----

export type SandboxMode = 'read-only' | 'workspace-write';
export type AskForApproval = 'on-request';

export type SandboxPolicy =
  | { type: 'readOnly'; networkAccess: boolean }
  | {
      type: 'workspaceWrite';
      writableRoots: string[];
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

export interface ThreadStartParams {
  cwd: string;
  approvalPolicy: AskForApproval;
  sandbox: SandboxMode;
  serviceName: string;
  developerInstructions: string;
  /** D31：userVisible 时为 "user"，否则不带这个字段。 */
  threadSource?: string;
  /** 覆盖 config.toml 的键（点分路径），见 mapping.ts 的 codexConfigOverrides。 */
  config?: Record<string, JsonValue> | null;
}

export interface ThreadResumeParams {
  threadId: string;
  cwd: string;
  approvalPolicy: AskForApproval;
  sandbox: SandboxMode;
  developerInstructions: string;
  /** 不要整段历史，历史在 Hub 自己的事件库里。 */
  excludeTurns: boolean;
  config?: Record<string, JsonValue> | null;
}

export interface CodexThread {
  id: string;
  model: string | null;
  reasoningEffort: string | null;
}

export interface ThreadStartResponse {
  thread: CodexThread;
  model: string;
  reasoningEffort: string | null;
}
export type ThreadResumeResponse = ThreadStartResponse;

export interface ThreadUnsubscribeParams {
  threadId: string;
}

// ---- 轮 ----

export interface TextInput {
  type: 'text';
  text: string;
  /** 必填，Hub 总是传空数组。 */
  text_elements: [];
}

export interface TurnStartParams {
  threadId: string;
  input: TextInput[];
  cwd: string;
  approvalPolicy: AskForApproval;
  sandboxPolicy: SandboxPolicy;
  model?: string;
  effort?: string;
  summary: 'auto';
}

export type CodexErrorInfo =
  | string
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } }
  | { [key: string]: unknown };

export interface TurnError {
  message: string;
  codexErrorInfo: CodexErrorInfo | null;
  additionalDetails: string | null;
}

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export interface CodexTurn {
  id: string;
  status: TurnStatus;
  error: TurnError | null;
}

export interface TurnStartResponse {
  turn: CodexTurn;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

// ---- item ----

export type ItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

export interface FileUpdateChange {
  path: string;
  kind: { type: 'add' } | { type: 'delete' } | { type: 'update'; move_path: string | null };
}

/** Hub 处理的 item；其他 type 的 item 也会到达，按未知处理（§5）。 */
export type ThreadItem =
  | { type: 'userMessage'; id: string }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | {
      type: 'commandExecution';
      id: string;
      command: string;
      cwd: string;
      status: ItemStatus;
      exitCode: number | null;
      durationMs: number | null;
    }
  | { type: 'fileChange'; id: string; changes: FileUpdateChange[]; status: ItemStatus }
  | {
      type: 'mcpToolCall';
      id: string;
      server: string;
      tool: string;
      status: 'inProgress' | 'completed' | 'failed';
      durationMs: number | null;
    }
  | {
      type: 'dynamicToolCall';
      id: string;
      tool: string;
      status: 'inProgress' | 'completed' | 'failed';
      durationMs: number | null;
    }
  | { type: 'webSearch'; id: string; query: string }
  | { type: 'imageView'; id: string; path: string }
  | { type: 'contextCompaction'; id: string };

// ---- 通知 ----

export interface ItemNotification {
  item: ThreadItem;
  threadId: string;
  turnId: string;
}

export interface DeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface TurnNotification {
  threadId: string;
  turn: CodexTurn;
}

export interface TurnPlanUpdatedNotification {
  threadId: string;
  turnId: string;
  explanation: string | null;
  plan: { step: string; status: 'pending' | 'inProgress' | 'completed' }[];
}

export interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ThreadTokenUsageUpdatedNotification {
  threadId: string;
  turnId: string;
  tokenUsage: {
    total: TokenUsageBreakdown;
    last: TokenUsageBreakdown;
    modelContextWindow: number | null;
  };
}

export interface ErrorNotification {
  error: TurnError;
  willRetry: boolean;
  threadId: string;
  turnId: string;
}

export interface WarningNotification {
  threadId: string | null;
  message: string;
}

export interface ModelReroutedNotification {
  threadId: string;
  turnId: string;
  fromModel: string;
  toModel: string;
}

export interface ServerRequestResolvedNotification {
  threadId: string;
  requestId: string | number;
}

export interface ThreadClosedNotification {
  threadId: string;
}

// ---- 服务端请求 ----

export interface CommandExecutionRequestApprovalParams {
  kind: 'command' | 'writeStdin';
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  networkApprovalContext?: { host: string; protocol: string } | null;
  command?: string | null;
  cwd?: string | null;
}

export interface FileChangeRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
}

/** Hub 只发这四种；会改 Codex 持久策略的 amendment 类决定不发。 */
export type ApprovalDecisionWire = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

export interface ApprovalDecisionResponse {
  decision: ApprovalDecisionWire;
}

export interface PermissionProfile {
  network?: { enabled: boolean | null };
  fileSystem?: { read: string[] | null; write: string[] | null };
}

export interface PermissionsRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  cwd: string;
  reason: string | null;
  permissions: {
    network: { enabled: boolean | null } | null;
    fileSystem: { read: string[] | null; write: string[] | null } | null;
  };
}

export interface PermissionsRequestApprovalResponse {
  permissions: PermissionProfile;
  scope: 'turn' | 'session';
}

export interface ToolRequestUserInputResponse {
  answers: Record<string, { answers: string[] }>;
}

export interface McpServerElicitationRequestResponse {
  action: 'decline';
  content: null;
  _meta: null;
}

/** 旧版接口（execCommandApproval、applyPatchApproval）的回复。 */
export interface LegacyApprovalResponse {
  decision: 'abort';
}
