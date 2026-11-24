/**
 * ACP 协议类型：取自 @agentclientprotocol/sdk 2.0.2 的稳定 v1 入口，只用 import type（D34）。
 * 另有两处稳定 schema 之外、实测仍在用的旧接口：session/new 等响应里的 models 字段，
 * 以及 session/set_model（Gemini CLI 0.65.0 只支持这一种选模型方式，§4.1）。
 */
import type {
  ClientCapabilities,
  CloseSessionRequest,
  InitializeRequest,
  InitializeResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
} from '@agentclientprotocol/sdk';
import type { JsonRpcConnection } from '../jsonrpc/connection';

export type {
  AgentCapabilities,
  CancelNotification,
  CancelRequestNotification,
  ClientCapabilities,
  ContentBlock,
  InitializeResponse,
  PermissionOption,
  PlanEntry as AcpPlanEntry,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionModeState,
  SessionNotification,
  SessionUpdate,
  StopReason as AcpStopReason,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  ToolCallUpdate,
  ToolKind as AcpToolKind,
  UsageUpdate,
} from '@agentclientprotocol/sdk';

export const ACP_PROTOCOL_VERSION = 1;

/** D36：不让 Agent 经 Hub 读写文件或开终端；只声明能显示 notice。 */
export const ACP_CLIENT_CAPABILITIES: ClientCapabilities = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  session: { notices: {} },
};

export const ACP_ERROR = {
  AUTH_REQUIRED: -32000,
  RESOURCE_NOT_FOUND: -32002,
  REQUEST_CANCELLED: -32800,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** 旧的模型字段（ACP 不稳定 schema 的 SessionModelState）。 */
export interface LegacySessionModelState {
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>;
  currentModelId: string;
}

export interface SetSessionModelRequest {
  sessionId: string;
  modelId: string;
}

type WithLegacyModels<T> = T & { models?: LegacySessionModelState | null };

/** Hub 发出的全部请求；acpRequest 只接受这些方法名。 */
export interface AcpRequestMap {
  initialize: { params: InitializeRequest; result: InitializeResponse };
  'session/new': { params: NewSessionRequest; result: WithLegacyModels<NewSessionResponse> };
  'session/load': { params: LoadSessionRequest; result: WithLegacyModels<LoadSessionResponse> };
  'session/resume': {
    params: ResumeSessionRequest;
    result: WithLegacyModels<ResumeSessionResponse>;
  };
  'session/set_config_option': {
    params: SetSessionConfigOptionRequest;
    result: SetSessionConfigOptionResponse;
  };
  'session/set_mode': { params: SetSessionModeRequest; result: unknown };
  'session/set_model': { params: SetSessionModelRequest; result: unknown };
  'session/prompt': { params: PromptRequest; result: PromptResponse };
  'session/close': { params: CloseSessionRequest; result: unknown };
}
export type AcpMethod = keyof AcpRequestMap;

/** Hub 发出的通知只有这一个。 */
export const ACP_CANCEL_METHOD = 'session/cancel';
/** Agent 发来、Hub 处理的方法；其余请求回 -32601，其余通知只进 transcript（§2）。 */
export const ACP_UPDATE_METHOD = 'session/update';
export const ACP_PERMISSION_METHOD = 'session/request_permission';
/** Agent 撤回它发给 Hub 的请求（例如未决的权限请求）。 */
export const ACP_CANCEL_REQUEST_METHOD = '$/cancel_request';
/** claude-agent-acp 的扩展通知：{ authStatus: { kind, label } }，kind 为 "none" 表示未登录。 */
export const ACP_AUTH_STATUS_METHOD = '_auth/status_update';

export function acpRequest<M extends AcpMethod>(
  conn: JsonRpcConnection,
  method: M,
  params: AcpRequestMap[M]['params'],
  timeoutMs?: number | null,
): Promise<AcpRequestMap[M]['result']> {
  return conn.request<AcpRequestMap[M]['result']>(
    method,
    params,
    timeoutMs === undefined ? {} : { timeoutMs },
  );
}
