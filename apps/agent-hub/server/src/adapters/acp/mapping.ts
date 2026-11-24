import {
  reasoningEffortLabel,
  type AgentError,
  type AgentEvent,
  type ApprovalDecision,
  type ApprovalKind,
  type ModelOption,
  type PlanEntry,
  type StopReason,
  type TaskMode,
  type ToolKind,
} from '@agent-hub/contract';
import { agentError, toJsonValue, type ApprovalRequestInput } from '../types';
import {
  ACP_ERROR,
  type AcpStopReason,
  type InitializeResponse,
  type LegacySessionModelState,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionConfigSelectOption,
  type SessionModeState,
  type SessionUpdate,
  type SetSessionModelRequest,
  type ToolCall,
  type ToolCallContent,
  type ToolCallLocation,
  type ToolCallUpdate,
} from './protocol';

/** 出现在错误说明里的名字；authHint 来自 profile（profiles.ts）。 */
export interface AcpNames {
  displayName: string;
  authHint: string;
}

// ───────────────────────── 握手 ─────────────────────────

export interface AcpAgentInfo {
  version: string | null;
  /** 恢复会话的方式：优先 session/resume，其次 session/load（§9）。 */
  resume: 'resume' | 'load' | null;
  /** 支持 session/close。 */
  close: boolean;
}

export function agentInfoFrom(init: InitializeResponse): AcpAgentInfo {
  const caps = init.agentCapabilities ?? {};
  const sessionCaps = caps.sessionCapabilities ?? {};
  return {
    version: init.agentInfo?.version ?? null,
    resume: sessionCaps.resume ? 'resume' : caps.loadSession ? 'load' : null,
    close: Boolean(sessionCaps.close),
  };
}

/** _auth/status_update 的参数表示未登录（claude-agent-acp 0.97.0 未登录时 session/new 照样成功）。 */
export function isLoggedOutStatus(params: unknown): boolean {
  return isRecord(params) && isRecord(params.authStatus) && params.authStatus.kind === 'none';
}

// ───────────────────────── 错误 ─────────────────────────

export interface AcpErrorLike {
  code: number;
  message: string;
  data?: unknown;
}

const MAX_ERROR_TEXT = 300;
const AUTH_TEXT =
  /authentication required|not logged in|unauthori[sz]ed|api[ _-]?key\b[^.]*\b(?:missing|not valid|invalid|not configured)|api_key_invalid/i;
const RATE_TEXT = /rate.?limit|quota|resource.?exhausted|too many requests/i;
const CONTEXT_TEXT =
  /context (?:window|length)|maximum context|prompt is too long|too many tokens/i;

/** 剥掉层层包裹的 JSON（Gemini 把上游响应原样放进 message），取第一行，最多 300 字。 */
export function acpErrorText(err: AcpErrorLike): string {
  let text = err.message;
  for (let depth = 0; depth < 4; depth++) {
    const inner = innerMessage(text);
    if (inner === null) break;
    text = inner;
  }
  const details = isRecord(err.data) ? err.data.details : undefined;
  if (typeof details === 'string' && /^internal error$/i.test(text.trim())) text = details;
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > MAX_ERROR_TEXT ? `${line.slice(0, MAX_ERROR_TEXT)}…` : line;
}

function innerMessage(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) return null;
    const nested = isRecord(parsed.error) ? parsed.error.message : parsed.message;
    return typeof nested === 'string' ? nested : null;
  } catch {
    return null;
  }
}

export type AcpErrorClass =
  | 'auth'
  | 'rate_limited'
  | 'context_exceeded'
  | 'not_found'
  | 'rejected'
  | 'upstream';

export function classifyAcpError(err: AcpErrorLike): AcpErrorClass {
  const text = `${err.message}\n${acpErrorText(err)}`;
  if (err.code === ACP_ERROR.AUTH_REQUIRED || err.code === 401 || err.code === 403) return 'auth';
  if (AUTH_TEXT.test(text)) return 'auth';
  if (err.code === 429 || RATE_TEXT.test(text)) return 'rate_limited';
  if (CONTEXT_TEXT.test(text)) return 'context_exceeded';
  if (err.code === ACP_ERROR.RESOURCE_NOT_FOUND) return 'not_found';
  if (
    err.code === ACP_ERROR.INVALID_REQUEST ||
    err.code === ACP_ERROR.METHOD_NOT_FOUND ||
    err.code === ACP_ERROR.INVALID_PARAMS
  ) {
    return 'rejected';
  }
  return 'upstream';
}

function errorDetail(err: AcpErrorLike) {
  return toJsonValue({ code: err.code, message: err.message.slice(0, 2000), data: err.data });
}

function authError(err: AcpErrorLike, names: AcpNames): AgentError {
  return agentError('AGENT_AUTH_REQUIRED', names.authHint, false, errorDetail(err));
}

/** session/prompt 的 JSON-RPC 错误 → 本轮的错误（§6.4）。 */
export function mapPromptError(err: AcpErrorLike, names: AcpNames): AgentError {
  const text = acpErrorText(err);
  const detail = errorDetail(err);
  switch (classifyAcpError(err)) {
    case 'auth':
      return authError(err, names);
    case 'rate_limited':
      return agentError('AGENT_RATE_LIMITED', `${names.displayName}：${text}`, true, detail);
    case 'context_exceeded':
      return agentError('AGENT_CONTEXT_EXCEEDED', `${names.displayName}：${text}`, false, detail);
    case 'not_found':
    case 'rejected':
      return agentError(
        'AGENT_PROTOCOL_ERROR',
        `${names.displayName} 拒绝了本轮请求：${text}`,
        false,
        detail,
      );
    case 'upstream': {
      const retryable =
        err.code === ACP_ERROR.INTERNAL_ERROR || (err.code >= 500 && err.code < 600);
      return agentError('AGENT_UPSTREAM_ERROR', `${names.displayName}：${text}`, retryable, detail);
    }
  }
}

/** 建会话（new）或恢复会话（resume / load）的 JSON-RPC 错误（§4.1 第 7 步）。 */
export function mapStartError(
  err: AcpErrorLike,
  names: AcpNames,
  phase: 'new' | 'resume' | 'load',
): AgentError {
  const kind = classifyAcpError(err);
  if (kind === 'auth') return authError(err, names);
  const text = acpErrorText(err);
  if (phase !== 'new') {
    return agentError(
      'SESSION_NOT_RESUMABLE',
      `${names.displayName} 无法恢复会话：${text}`,
      false,
      errorDetail(err),
    );
  }
  if (kind === 'rate_limited') {
    return agentError(
      'AGENT_RATE_LIMITED',
      `${names.displayName}：${text}`,
      true,
      errorDetail(err),
    );
  }
  return agentError(
    'AGENT_PROTOCOL_ERROR',
    `${names.displayName} 无法新建会话：${text}`,
    false,
    errorDetail(err),
  );
}

/** 切换模型、推理档位或会话模式失败（§4.3、§5）。 */
export function mapConfigError(
  err: AcpErrorLike,
  names: AcpNames,
  change: ConfigChange,
): AgentError {
  if (classifyAcpError(err) === 'auth') return authError(err, names);
  const text = acpErrorText(err);
  if (change.target === 'mode') {
    return agentError(
      'AGENT_PROTOCOL_ERROR',
      `${names.displayName} 无法切换到“${change.value}”模式：${text}`,
      false,
      errorDetail(err),
    );
  }
  const what = change.target === 'model' ? '模型' : '推理档位';
  return agentError(
    'MODEL_NOT_SUPPORTED',
    `${names.displayName} 拒绝切换${what}“${change.value}”：${text}`,
    false,
    errorDetail(err),
  );
}

// ───────────────────────── 会话配置：模型、推理档位、模式 ─────────────────────────

type SelectConfigOption = Extract<SessionConfigOption, { type: 'select' }>;

/** 一个会话的配置项、模式与旧模型字段；每次 Agent 告知新值就整体替换（§4.2）。 */
export interface AcpConfigState {
  options: SessionConfigOption[];
  modes: SessionModeState | null;
  legacyModels: LegacySessionModelState | null;
}

export function configStateFrom(response: {
  configOptions?: SessionConfigOption[] | null;
  modes?: SessionModeState | null;
  models?: unknown;
}): AcpConfigState {
  return {
    options: response.configOptions ?? [],
    modes: response.modes ?? null,
    legacyModels: isLegacyModels(response.models) ? response.models : null,
  };
}

function isLegacyModels(value: unknown): value is LegacySessionModelState {
  return (
    isRecord(value) &&
    typeof value.currentModelId === 'string' &&
    Array.isArray(value.availableModels) &&
    value.availableModels.every(
      (m) => isRecord(m) && typeof m.modelId === 'string' && typeof m.name === 'string',
    )
  );
}

/** set_config_option 的响应、config_option_update 通知：替换配置项，并同步模式。 */
export function withConfigOptions(
  state: AcpConfigState,
  options: SessionConfigOption[],
): AcpConfigState {
  const next: AcpConfigState = { ...state, options };
  const mode = selectOption(next, 'mode');
  if (mode && next.modes) next.modes = { ...next.modes, currentModeId: mode.currentValue };
  return next;
}

/** current_mode_update 通知、set_mode 成功。 */
export function withCurrentMode(state: AcpConfigState, modeId: string): AcpConfigState {
  return {
    ...state,
    modes: state.modes ? { ...state.modes, currentModeId: modeId } : null,
    options: state.options.map((o) =>
      o.type === 'select' && o.category === 'mode' ? { ...o, currentValue: modeId } : o,
    ),
  };
}

/** set_model 成功（Agent 不另发通知）。 */
export function withLegacyModel(state: AcpConfigState, modelId: string): AcpConfigState {
  return state.legacyModels
    ? { ...state, legacyModels: { ...state.legacyModels, currentModelId: modelId } }
    : state;
}

export function selectOption(
  state: AcpConfigState,
  category: 'mode' | 'model' | 'thought_level',
): SelectConfigOption | null {
  for (const option of state.options) {
    if (option.type === 'select' && option.category === category) return option;
  }
  return null;
}

function flatten(option: SelectConfigOption): SessionConfigSelectOption[] {
  return option.options.flatMap(
    (o: SessionConfigSelectOption | { options: SessionConfigSelectOption[] }) =>
      'options' in o ? o.options : [o],
  );
}

export function currentModel(state: AcpConfigState): string | null {
  return selectOption(state, 'model')?.currentValue ?? state.legacyModels?.currentModelId ?? null;
}

export function currentMode(state: AcpConfigState): string | null {
  return selectOption(state, 'mode')?.currentValue ?? state.modes?.currentModeId ?? null;
}

export function availableModeIds(state: AcpConfigState): string[] {
  const option = selectOption(state, 'mode');
  if (option) return flatten(option).map((o) => o.value);
  return state.modes?.availableModes.map((m) => m.id) ?? [];
}

/** profile.modes[任务模式] 里第一个 Agent 提供的模式；没有则不管理模式（D37）。 */
export function pickTargetMode(
  state: AcpConfigState,
  preferences: readonly string[],
): string | null {
  const available = availableModeIds(state);
  return preferences.find((id) => available.includes(id)) ?? null;
}

/**
 * 会话可以停留的模式（§5 模式守卫）：只读任务只允许目标模式；
 * 可写任务另外允许 profile 里的只读模式（Agent 自己进入计划模式更保守，不拦）。
 */
export function allowedModes(
  target: string,
  modes: Record<TaskMode, readonly string[]>,
  taskMode: TaskMode,
): string[] {
  return taskMode === 'read_only'
    ? [target]
    : [...new Set([target, ...modes.write, ...modes.read_only])];
}

export type ConfigChange =
  | {
      target: 'model' | 'effort' | 'mode';
      value: string;
      method: 'session/set_config_option';
      params: { sessionId: string; configId: string; value: string };
    }
  | {
      target: 'model';
      value: string;
      method: 'session/set_model';
      params: SetSessionModelRequest;
    }
  | {
      target: 'mode';
      value: string;
      method: 'session/set_mode';
      params: { sessionId: string; modeId: string };
    };

/** 有 mode 类配置项时用 set_config_option（Claude Code、Qoder），否则 set_mode（Gemini）。 */
export function modeChange(state: AcpConfigState, sessionId: string, modeId: string): ConfigChange {
  const option = selectOption(state, 'mode');
  return option
    ? {
        target: 'mode',
        value: modeId,
        method: 'session/set_config_option',
        params: { sessionId, configId: option.id, value: modeId },
      }
    : { target: 'mode', value: modeId, method: 'session/set_mode', params: { sessionId, modeId } };
}

/**
 * 发提示词前把模型、推理档位对齐到本轮的目标值（§4.3）：返回下一步要发的请求，已对齐时返回 null，
 * 用户明确要求了 Agent 不提供的值时返回错误。会话每应用一步就更新状态再调用一次。
 * 目标值：用户选的值；没选时用 models（Agent 能力）里的默认模型及其默认档位；models 为空则不动。
 * 用户明确要求的值在发出任何请求前一起校验，避免切了模型才发现档位不支持。
 */
export function nextTurnChange(
  state: AcpConfigState,
  models: ModelOption[],
  input: { model: string | null; reasoningEffort: string | null },
  sessionId: string,
  names: AcpNames,
): ConfigChange | AgentError | null {
  const notSupported = (message: string) =>
    agentError('MODEL_NOT_SUPPORTED', `${names.displayName} ${message}`, false);
  const modelOption = selectOption(state, 'model');
  const effortOption = selectOption(state, 'thought_level');
  const modelIds = modelOption
    ? flatten(modelOption).map((o) => o.value)
    : (state.legacyModels?.availableModels.map((m) => m.modelId) ?? null);
  const effortIds = effortOption ? flatten(effortOption).map((o) => o.value) : null;

  if (input.model !== null) {
    if (modelIds === null) return notSupported('不支持选择模型');
    if (!modelIds.includes(input.model)) return notSupported(`没有模型“${input.model}”`);
  }
  if (input.reasoningEffort !== null) {
    if (effortIds === null) return notSupported('不支持选择推理档位');
    if (!effortIds.includes(input.reasoningEffort)) {
      return notSupported(`没有推理档位“${input.reasoningEffort}”`);
    }
  }

  const wantModel = input.model ?? models.find((m) => m.isDefault)?.id ?? null;
  if (wantModel !== null && modelIds?.includes(wantModel) && currentModel(state) !== wantModel) {
    return modelOption
      ? {
          target: 'model',
          value: wantModel,
          method: 'session/set_config_option',
          params: { sessionId, configId: modelOption.id, value: wantModel },
        }
      : {
          target: 'model',
          value: wantModel,
          method: 'session/set_model',
          params: { sessionId, modelId: wantModel },
        };
  }

  const effectiveModel = wantModel ?? currentModel(state);
  const wantEffort =
    input.reasoningEffort ??
    models.find((m) => m.id === effectiveModel)?.defaultReasoningEffort ??
    null;
  if (
    wantEffort === null ||
    !effortOption ||
    !effortIds?.includes(wantEffort) ||
    effortOption.currentValue === wantEffort
  ) {
    return null;
  }
  return {
    target: 'effort',
    value: wantEffort,
    method: 'session/set_config_option',
    params: { sessionId, configId: effortOption.id, value: wantEffort },
  };
}

/**
 * Agent 能力里的模型列表：model 类配置项（或旧 models 字段）的每个值一个模型；
 * thought_level 类配置项的值作为每个模型的推理档位（ACP 只告知当前模型的档位，§4.2）。
 * 只用 session/new 的响应调用：那时的当前值就是 Agent 的默认值。
 */
export function normalizeAcpModels(state: AcpConfigState): ModelOption[] {
  const effort = selectOption(state, 'thought_level');
  const efforts = effort
    ? flatten(effort).map((o) => ({
        id: o.value,
        label: reasoningEffortLabel(o.value),
        description: o.description || undefined,
      }))
    : [];
  const defaultEffort = efforts.length > 0 && effort ? effort.currentValue : null;
  const modelOption = selectOption(state, 'model');
  const raw = modelOption
    ? flatten(modelOption).map((o) => ({
        id: o.value,
        label: o.name || o.value,
        description: o.description || undefined,
        isDefault: o.value === modelOption.currentValue,
      }))
    : (state.legacyModels?.availableModels.map((m) => ({
        id: m.modelId,
        label: m.name || m.modelId,
        description: m.description || undefined,
        isDefault: m.modelId === state.legacyModels?.currentModelId,
      })) ?? []);
  const seen = new Set<string>();
  return raw
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .map((m) => ({ ...m, reasoningEfforts: efforts, defaultReasoningEffort: defaultEffort }));
}

// ───────────────────────── 工具、轮内事件 ─────────────────────────

export function toolKindOf(kind: string | null | undefined): ToolKind {
  switch (kind) {
    case 'execute':
      return 'command';
    case 'read':
    case 'edit':
    case 'delete':
    case 'move':
    case 'search':
    case 'fetch':
    case 'think':
      return kind;
    default:
      return 'other';
  }
}

const TOOL_LABELS: Record<string, string> = {
  read: '读取',
  edit: '修改',
  delete: '删除',
  move: '移动',
  search: '搜索',
  execute: '执行命令',
  think: '思考',
  fetch: '联网获取',
  switch_mode: '切换模式',
};

/** “执行命令：git status”；Agent 给的标题压成一行、最多 120 字。 */
export function toolTitle(
  kind: string | null | undefined,
  title: string | null | undefined,
): string {
  const label = (kind && TOOL_LABELS[kind]) || '工具';
  const text = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return label;
  return `${label}：${text.length > 120 ? `${text.slice(0, 120)}…` : text}`;
}

export function commandOf(rawInput: unknown): string | null {
  if (!isRecord(rawInput)) return null;
  const command = rawInput.command;
  if (typeof command === 'string' && command.trim()) return command;
  if (Array.isArray(command) && command.every((c) => typeof c === 'string')) {
    return command.length > 0 ? command.join(' ') : null;
  }
  return null;
}

export function pathsOf(locations: ToolCallLocation[] | null | undefined): string[] {
  return [...new Set((locations ?? []).map((l) => l.path).filter(Boolean))];
}

/** 工具内容 → 文本：text 原样，diff 写一行“已修改 <路径>”，其他忽略。 */
export function renderToolContent(content: ToolCallContent[]): string {
  const parts: string[] = [];
  for (const c of content) {
    if (c.type === 'content' && c.content.type === 'text' && c.content.text)
      parts.push(c.content.text);
    else if (c.type === 'diff') parts.push(`已修改 ${c.path}`);
  }
  return parts.join('\n');
}

const STOP_REASONS_ACP: readonly string[] = [
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
];

/** 五个取值与 Hub 同名；协议以后新增、Hub 不认识的值按 end_turn 处理。 */
export function mapStopReason(stop: AcpStopReason): StopReason {
  return STOP_REASONS_ACP.includes(stop) ? stop : 'end_turn';
}

export const PLAN_EXIT_DECLINED_MESSAGE =
  'Agent 请求退出计划模式开始修改；这是只读任务，Hub 已代为拒绝，本轮到此结束。需要修改请新建可写任务。';

/**
 * session/prompt 的 stopReason → 本轮结果（§6.1 第 5 步）。Claude Code 在“退出计划模式”被拒后
 * 以 cancelled 结束本轮；那不是人取消的，记为 end_turn 并说明原因。
 */
export function turnStop(
  stop: AcpStopReason,
  flags: { cancelRequested: boolean; modeSwitchDeclined: boolean },
): { stopReason: StopReason; notice: AgentEvent | null } {
  const stopReason = mapStopReason(stop);
  if (stopReason === 'cancelled' && !flags.cancelRequested && flags.modeSwitchDeclined) {
    return {
      stopReason: 'end_turn',
      notice: {
        type: 'notice',
        level: 'info',
        code: 'PLAN_EXIT_DECLINED',
        message: PLAN_EXIT_DECLINED_MESSAGE,
      },
    };
  }
  return { stopReason, notice: null };
}

type NoticeUpdate = Extract<SessionUpdate, { sessionUpdate: 'notice' }>;

function noticeEvent(n: NoticeUpdate): AgentEvent {
  const message = n.description ? `${n.title}：${n.description}` : n.title;
  return n.severity === 'warning' || n.severity === 'error'
    ? { type: 'notice', level: n.severity, code: 'AGENT_WARNING', message }
    : { type: 'notice', level: 'info', message };
}

function planStatus(status: string): PlanEntry['status'] {
  return status === 'in_progress' || status === 'completed' ? status : 'pending';
}

interface Segment {
  kind: 'message' | 'reasoning';
  itemId: string;
  messageId: string | null;
  text: string;
}

interface ToolState {
  itemId: string;
  /** 已作为 tool.output.delta 发出的完整文本。 */
  emitted: string;
  declined: boolean;
  done: boolean;
}

/**
 * 一轮内的 session/update → AgentEvent（§6.2）。纯状态机，不做 IO；每轮新建一个。
 * itemId：消息 t<轮序号>-msg-<n>，推理 t<轮序号>-think-<n>，工具 t<轮序号>-tool-<toolCallId>。
 */
export class AcpTurnMapper {
  private segment: Segment | null = null;
  private seq = 0;
  private readonly tools = new Map<string, ToolState>();
  private readonly compactions = new Set<string>();

  constructor(private readonly turnIndex: number) {}

  map(update: SessionUpdate): AgentEvent[] {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return this.chunk('message', update.content, update.messageId ?? null);
      case 'agent_thought_chunk':
        return this.chunk('reasoning', update.content, update.messageId ?? null);
      case 'tool_call':
        return [...this.closeSegment(), ...this.ensureTool(update), ...this.updateTool(update)];
      case 'tool_call_update':
        return [...this.ensureTool(update), ...this.updateTool(update)];
      case 'plan':
        return [
          {
            type: 'plan.updated',
            explanation: null,
            entries: update.entries.map((e) => ({ step: e.content, status: planStatus(e.status) })),
          },
        ];
      case 'usage_update':
        return [
          {
            type: 'usage.updated',
            usage: { totalTokens: update.used, contextWindow: update.size },
          },
        ];
      case 'notice':
        return [noticeEvent(update)];
      case 'compaction_update':
        if (update.status !== 'completed' || this.compactions.has(update.compactionId)) return [];
        this.compactions.add(update.compactionId);
        return [
          {
            type: 'notice',
            level: 'info',
            code: 'CONTEXT_COMPACTED',
            message: 'Agent 压缩了会话上下文',
          },
        ];
      default:
        return [];
    }
  }

  /** tool_call_update（含权限请求里的 toolCall）可能先于 tool_call 到达：先补一个 tool.started。 */
  private ensureTool(call: ToolCall | ToolCallUpdate): AgentEvent[] {
    if (this.tools.has(call.toolCallId)) return [];
    const itemId = `t${this.turnIndex}-tool-${call.toolCallId}`;
    this.tools.set(call.toolCallId, { itemId, emitted: '', declined: false, done: false });
    const started: Extract<AgentEvent, { type: 'tool.started' }> = {
      type: 'tool.started',
      itemId,
      toolKind: toolKindOf(call.kind),
      title: toolTitle(call.kind, call.title),
    };
    const command = call.kind === 'execute' ? commandOf(call.rawInput) : null;
    if (command) started.command = command;
    const paths = pathsOf(call.locations);
    if (paths.length > 0) started.paths = paths;
    return [started];
  }

  /** Hub 拒绝了该工具的权限请求：之后以 failed 结束时记为 declined。 */
  markDeclined(toolCallId: string): void {
    const tool = this.tools.get(toolCallId);
    if (tool) tool.declined = true;
  }

  /** 轮结束：补发未结束的消息 / 推理段与工具（接口 §3.1 规则 4）。 */
  finish(): AgentEvent[] {
    const events = this.closeSegment();
    for (const tool of this.tools.values()) {
      if (tool.done) continue;
      tool.done = true;
      events.push({
        type: 'tool.completed',
        itemId: tool.itemId,
        status: tool.declined ? 'declined' : 'failed',
      });
    }
    return events;
  }

  private chunk(
    kind: Segment['kind'],
    content: { type: string; text?: string },
    messageId: string | null,
  ): AgentEvent[] {
    const text = content.type === 'text' && typeof content.text === 'string' ? content.text : '';
    const events: AgentEvent[] = [];
    const current = this.segment;
    const continues =
      current !== null &&
      current.kind === kind &&
      (messageId === null || current.messageId === null || current.messageId === messageId);
    if (!continues) {
      events.push(...this.closeSegment());
      if (!text) return events;
      this.seq += 1;
      this.segment = {
        kind,
        itemId: `t${this.turnIndex}-${kind === 'message' ? 'msg' : 'think'}-${this.seq}`,
        messageId,
        text: '',
      };
    }
    const segment = this.segment;
    if (!text || !segment) return events;
    segment.text += text;
    segment.messageId ??= messageId;
    events.push({
      type: kind === 'message' ? 'message.delta' : 'reasoning.delta',
      itemId: segment.itemId,
      text,
    });
    return events;
  }

  private closeSegment(): AgentEvent[] {
    const segment = this.segment;
    if (!segment) return [];
    this.segment = null;
    return [
      {
        type: segment.kind === 'message' ? 'message.completed' : 'reasoning.completed',
        itemId: segment.itemId,
        text: segment.text,
      },
    ];
  }

  private updateTool(call: ToolCall | ToolCallUpdate): AgentEvent[] {
    const tool = this.tools.get(call.toolCallId);
    if (!tool || tool.done) return [];
    const events: AgentEvent[] = [];
    if (call.content) {
      const full = renderToolContent(call.content);
      const delta = full.startsWith(tool.emitted)
        ? full.slice(tool.emitted.length)
        : `${tool.emitted ? '\n' : ''}${full}`;
      if (delta) events.push({ type: 'tool.output.delta', itemId: tool.itemId, text: delta });
      tool.emitted = full;
    }
    if (call.status === 'completed' || call.status === 'failed') {
      tool.done = true;
      events.push({
        type: 'tool.completed',
        itemId: tool.itemId,
        status: call.status === 'completed' ? 'completed' : tool.declined ? 'declined' : 'failed',
      });
    }
    return events;
  }
}

// ───────────────────────── 权限请求 ─────────────────────────

/** 接口 §5.2：allow_always / reject_always 永远不选（会改 Agent 的持久设置），所以没有 allow_for_session。 */
export function permissionDecisions(options: PermissionOption[]): ApprovalDecision[] {
  const decisions: ApprovalDecision[] = [];
  if (options.some((o) => o.kind === 'allow_once')) decisions.push('allow_once');
  if (options.some((o) => o.kind === 'reject_once')) decisions.push('reject');
  decisions.push('cancel_turn');
  return decisions;
}

const APPROVAL_KINDS: Record<string, ApprovalKind> = {
  execute: 'command',
  edit: 'file_change',
  delete: 'file_change',
  move: 'file_change',
  fetch: 'network',
};

export function approvalFromPermission(
  req: RequestPermissionRequest,
  cwd: string,
): ApprovalRequestInput {
  const call = req.toolCall;
  const input: ApprovalRequestInput = {
    kind: (call.kind && APPROVAL_KINDS[call.kind]) || 'other',
    title: toolTitle(call.kind, call.title),
    options: permissionDecisions(req.options),
    detail: toJsonValue({
      toolCall: {
        toolCallId: call.toolCallId,
        kind: call.kind,
        title: call.title,
        rawInput: call.rawInput,
        locations: call.locations,
      },
      options: req.options,
    }),
  };
  if (call.kind === 'execute') {
    input.cwd = cwd;
    const command = commandOf(call.rawInput);
    if (command) input.command = command;
  }
  const paths = pathsOf(call.locations);
  if (paths.length > 0) input.paths = paths;
  return input;
}

/** decision 为 null 表示撤回（本轮结束、取消、释放）：回 cancelled。 */
export function permissionResponse(
  decision: ApprovalDecision | null,
  options: PermissionOption[],
): RequestPermissionResponse {
  const wanted =
    decision === 'allow_once' ? 'allow_once' : decision === 'reject' ? 'reject_once' : null;
  const chosen = wanted ? options.find((o) => o.kind === wanted) : undefined;
  return chosen
    ? { outcome: { outcome: 'selected', optionId: chosen.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

/** 只读任务里 Agent 请求切换模式（Claude Code 的“退出计划模式”）：Hub 代为拒绝（§7.2）。 */
export function isModeSwitchRequest(req: RequestPermissionRequest): boolean {
  return req.toolCall.kind === 'switch_mode';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
