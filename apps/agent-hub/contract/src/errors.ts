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
