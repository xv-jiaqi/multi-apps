import type { Readable, Writable } from 'node:stream';
import type {
  AdapterKind,
  AgentCapabilities,
  AgentError,
  AgentEvent,
  AgentHealth,
  ApprovalDecision,
  ApprovalKind,
  JsonValue,
  StopReason,
  TaskMode,
  UsageInfo,
  WorkspaceKind,
} from '@agent-hub/contract';

/** 网页 Agent 的任务分支（web-agent.md §3）。 */
export interface RemoteBranchWorkspace {
  /** git remote 名，即仓库配置的 internalRemote。 */
  remote: string;
  /** agent-hub/<shortId>。 */
  branch: string;
  baseCommit: string;
  /** internal 的推送地址，已去掉 userinfo；显示给人填进 AoneD。 */
  repoUrl: string;
}

export interface StartSessionParams {
  taskId: string;
  shortId: string;
  /** Agent 的工作目录（绝对路径）。remote_branch 时是原仓库路径，只用于 git 操作。 */
  cwd: string;
  mode: TaskMode;
  workspace: WorkspaceKind;
  /** 有值时恢复这个原生会话（追问且活动会话表里没有会话时）。 */
  resumeNativeSessionId: string | null;
  /** Codex threadSource "user"（D31）；其他适配器忽略。 */
  userVisible: boolean;
  /** 只有 remote_branch 有值。 */
  remote: RemoteBranchWorkspace | null;
  /** 任务在 preparing 阶段被取消时中止。 */
  signal: AbortSignal;
}

export interface PromptInput {
  turnId: string;
  /** 轮序号，从 1 开始。 */
  index: number;
  text: string;
  /** 本轮要用的模型；null = Agent 自己的默认值。 */
  model: string | null;
  reasoningEffort: string | null;
}

export interface TurnResult {
  stopReason: StopReason;
  /** stopReason 为 'error' 时必有。 */
  error?: AgentError;
  usage?: UsageInfo;
  /** Codex 的 turn id；ACP、网页没有。 */
  nativeTurnId?: string;
}

export interface ApprovalRequestInput {
  kind: ApprovalKind;
  /** 一句话中文标题，例如“执行命令”“修改 3 个文件”。 */
  title: string;
  command?: string;
  cwd?: string;
  paths?: string[];
  reason?: string;
  /** 协议原始请求的参数（核心落库前脱敏）。 */
  detail?: JsonValue;
  /** 非空；按协议给出的选项过滤后的决定（§5.2）。 */
  options: ApprovalDecision[];
}

/**
 * decision：人做了决定，或系统代为决定（超时、停机、无进行中的轮，§5.1）；
 * withdrawn：适配器自己中止了 signal（Agent 撤回请求、本轮结束、进程退出）。
 */
export type ApprovalOutcome = { decision: ApprovalDecision } | { withdrawn: true };

/** 核心交给适配器的回调；一个会话一个 sink，由 TaskRunner 创建。 */
export interface AgentEventSink {
  emit(event: AgentEvent): void;
  /** 落库并广播一条 pending 审批，等待结局。永不 reject。 */
  requestApproval(input: ApprovalRequestInput, signal: AbortSignal): Promise<ApprovalOutcome>;
  /** 原始协议帧（一行 JSON）；诊断开关关闭时是空操作。 */
  raw(direction: 'in' | 'out', frame: string): void;
}

export type DisposeReason =
  | 'idle'
  | 'cancelled'
  | 'shutdown'
  | 'agent_exited'
  | 'config_changed'
  | 'deleted';

export interface AgentSession {
  readonly nativeSessionId: string;
  /** 发出提示词，本轮结束时 resolve。同一会话同一时刻只有一个 prompt。不因 Agent 的业务错误而 reject。 */
  prompt(input: PromptInput): Promise<TurnResult>;
  /** 协议级中断当前轮；没有进行中的轮时什么都不做。幂等，不抛错。 */
  cancelTurn(): Promise<void>;
  /** 释放会话占用的资源。进行中的 prompt 随之 resolve（§6.1 规则 5）。幂等，不抛错。 */
  dispose(reason: DisposeReason): Promise<void>;
  /** 会话不能再用时 resolve：被 dispose，或 Agent 进程退出。 */
  readonly closed: Promise<void>;
}

/** 网页 Agent 的会话多一个“完成本轮”（web-agent.md §3.3）。 */
export interface WebSession extends AgentSession {
  completeTurn(): Promise<void>;
}

export function isWebSession(session: AgentSession): session is WebSession {
  return typeof (session as Partial<WebSession>).completeTurn === 'function';
}

export interface ProbeResult {
  health: AgentHealth;
  capabilities: AgentCapabilities;
}

export interface AgentAdapter {
  /** config.json 里的 agents[].id。 */
  readonly id: string;
  readonly kind: AdapterKind;
  /** 缓存的能力；构造后立即可用（还没探测到的部分为空），同步返回。 */
  capabilities(): AgentCapabilities;
  /** 健康检查并刷新能力（§9.2）。不抛错：失败体现在 health 里。 */
  probe(): Promise<ProbeResult>;
  /** 新建或恢复原生会话。失败抛 AgentFailure。 */
  startSession(params: StartSessionParams, sink: AgentEventSink): Promise<AgentSession>;
  /** 侧车停机或配置变更：结束全部会话和子进程。幂等。 */
  shutdown(): Promise<void>;
}

/** startSession 的失败；TaskRunner 把 error 写进轮和任务的 lastError。 */
export class AgentFailure extends Error {
  constructor(readonly error: AgentError) {
    super(error.message);
  }
}

/** 协议对象 → JsonValue（丢掉 undefined 字段），用于 AgentError.detail 与审批 detail。 */
export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

export function agentError(
  code: AgentError['code'],
  message: string,
  retryable: boolean,
  detail?: JsonValue,
): AgentError {
  return detail === undefined ? { code, message, retryable } : { code, message, retryable, detail };
}

export interface AdapterLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** 适配器主动上报的状态变化；AdapterRegistry 更新缓存，GET /agents 读取（§9.2）。 */
export interface AdapterReporter {
  health(health: AgentHealth): void;
  capabilities(capabilities: AgentCapabilities): void;
}

export interface AdapterDeps {
  supervisor: ProcessSupervisor;
  logger: AdapterLogger;
  report: AdapterReporter;
  /** Agent 子进程的环境变量（GitGuard 构造，含推送守卫与 envPassthrough，security.md §3.2）。 */
  agentEnv(): Record<string, string>;
  now(): Date;
  /** 侧车版本（server/package.json 的 version），握手时作为 clientInfo.version。 */
  hubVersion: string;
  /** ACP 探测进程的 cwd：<AGENT_HUB_HOME>/probe，侧车启动时创建的空目录（adapter-acp.md §4.2）。 */
  probeCwd: string;
}

export interface SpawnSpec {
  /** 绝对路径，先用 resolveExecutable 解析。 */
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** 日志与 processes 表用，例如 "codex:codex"、"acp:qoder:3f9a1c2b"、"setup:3f9a1c2b"。 */
  label: string;
  taskId: string | null;
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface TerminateOptions {
  /** 关闭 stdin 后等多久再发 SIGTERM，默认 3000。 */
  stdinGraceMs?: number;
  /** SIGTERM 后等多久再发 SIGKILL，默认 2000。 */
  termGraceMs?: number;
}

export interface ManagedProcess {
  readonly pid: number;
  readonly label: string;
  readonly stdin: Writable;
  readonly stdout: Readable;
  /** 进程（组长）退出时 resolve，永不 reject。 */
  readonly exited: Promise<ExitInfo>;
  /** stderr 的最后 4 KB（原文，写日志前要 redact）。 */
  stderrTail(): string;
  /** 关闭 stdin → 等待 → SIGTERM 进程组 → 等待 → SIGKILL 进程组。幂等。 */
  terminate(options?: TerminateOptions): Promise<ExitInfo>;
}

export interface ProcessSupervisor {
  /** 登录 shell 的 PATH（§8.1）。 */
  loginPath(): Promise<string>;
  /** 命令名按登录 PATH 解析成绝对路径；绝对路径则检查可执行。找不到返回 null。 */
  resolveExecutable(command: string): Promise<string | null>;
  /** 以独立进程组启动并登记到 processes 表。启动失败抛 AgentFailure（AGENT_SPAWN_FAILED）。 */
  spawn(spec: SpawnSpec): Promise<ManagedProcess>;
  /** 侧车启动时清理上次残留的进程组，返回清理的组数（§8.3）。 */
  cleanupOrphans(): Promise<number>;
  /** 停机：并行 terminate 全部存活进程。 */
  terminateAll(options?: TerminateOptions): Promise<void>;
}
