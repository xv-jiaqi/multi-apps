import type {
  AcpAgentConfig,
  AgentCapabilities,
  AgentError,
  AgentHealth,
  ModelOption,
  TaskMode,
} from '@agent-hub/contract';
import {
  JsonRpcClosedError,
  JsonRpcError,
  JsonRpcTimeoutError,
  type JsonRpcConnection,
  type JsonRpcId,
} from '../jsonrpc/connection';
import { SHUTDOWN_TERMINATE } from '../process/supervisor';
import {
  AgentFailure,
  agentError,
  toJsonValue,
  type AdapterDeps,
  type AgentEventSink,
  type AgentSession,
  type DisposeReason,
  type ExitInfo,
  type ManagedProcess,
  type PromptInput,
  type StartSessionParams,
  type TurnResult,
} from '../types';
import { launchAcp, type AcpProcess } from './launch';
import {
  AcpTurnMapper,
  allowedModes,
  approvalFromPermission,
  configStateFrom,
  currentMode,
  currentModel,
  isLoggedOutStatus,
  isModeSwitchRequest,
  mapConfigError,
  mapPromptError,
  mapStartError,
  modeChange,
  nextTurnChange,
  permissionResponse,
  pickTargetMode,
  turnStop,
  withConfigOptions,
  withCurrentMode,
  withLegacyModel,
  type AcpAgentInfo,
  type AcpConfigState,
  type AcpNames,
  type ConfigChange,
} from './mapping';
import type { AcpProfile } from './profiles';
import {
  ACP_AUTH_STATUS_METHOD,
  ACP_CANCEL_METHOD,
  ACP_CANCEL_REQUEST_METHOD,
  ACP_ERROR,
  ACP_PERMISSION_METHOD,
  ACP_UPDATE_METHOD,
  acpRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from './protocol';

/** §4.5：每轮发提示词前最多对齐 3 次。 */
const MAX_TURN_CHANGES = 3;
/** §6.4：session/close 2 秒。 */
const CLOSE_TIMEOUT_MS = 2000;
/** §8.3：连接先关闭而进程还在，5 秒后结束进程。 */
const CONN_CLOSED_GRACE_MS = 5000;

/** AcpSession 需要的适配器侧状态（acp-adapter.ts 实现）。 */
export interface AcpSessionHost {
  config: AcpAgentConfig;
  deps: AdapterDeps;
  profile: AcpProfile;
  names: AcpNames;
  /** 适配器缓存的模型（最近一次新建会话得到的）。 */
  models(): ModelOption[];
  /** 新建会话成功后更新能力（§4.3 第 7 步）。 */
  sessionCreated(state: AcpConfigState, info: AcpAgentInfo): void;
  setHealth(health: AgentHealth): void;
  healthStatus(): AgentHealth['status'];
  release(session: AcpSession): void;
}

interface PendingApproval {
  controller: AbortController;
  cancelledByAgent: boolean;
}

interface ActiveTurn {
  turnId: string;
  index: number;
  mapper: AcpTurnMapper;
  promptSent: boolean;
  cancelRequested: boolean;
  modeSwitchDeclined: boolean;
  fatal: AgentError | null;
  approvals: Map<JsonRpcId, PendingApproval>;
  resolve(result: TurnResult): void;
  done: boolean;
}

type RequestFailure =
  | { kind: 'rpc'; error: JsonRpcError }
  | { kind: 'error'; error: AgentError }
  | { kind: 'closed' };

/** adapter-acp.md §4.3–§9：一个任务一个 ACP 进程、一个 ACP session。 */
export class AcpSession implements AgentSession {
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private proc: AcpProcess | null = null;
  private sessionId: string | null = null;
  private state: AcpConfigState = { options: [], modes: null, legacyModels: null };
  private targetMode: string | null = null;
  private allowed: string[] = [];
  private replaying = false;
  private loggedOut = false;
  private turn: ActiveTurn | null = null;
  private guardRunning: Promise<void> | null = null;
  private guardAgain = false;
  private disposing: Promise<void> | null = null;
  private exit: ExitInfo | null = null;
  private isClosed = false;

  constructor(
    private readonly host: AcpSessionHost,
    private readonly params: StartSessionParams,
    private readonly sink: AgentEventSink,
  ) {
    this.closed = new Promise((r) => (this.resolveClosed = r));
  }

  get nativeSessionId(): string {
    return this.sessionId ?? '';
  }

  private get names(): AcpNames {
    return this.host.names;
  }

  private get logger() {
    return this.host.deps.logger;
  }

  // ───────────────────────── 建会话（§4.3） ─────────────────────────

  async open(): Promise<void> {
    const { params, host } = this;
    const onAbort = () => void this.proc?.managed.terminate();
    params.signal.addEventListener('abort', onAbort, { once: true });
    try {
      this.proc = await launchAcp({
        config: host.config,
        deps: host.deps,
        names: this.names,
        cwd: params.cwd,
        label: `acp:${host.config.id}:${params.shortId}`,
        taskId: params.taskId,
        onNotification: (method, p) => this.onNotification(method, p),
        onRequest: (method, p, id) => this.onRequest(method, p, id),
        onRaw: (direction, line) => this.sink.raw(direction, line),
      });
      const proc = this.proc;
      if (params.signal.aborted) {
        await this.endProcess();
        throw new AgentFailure(agentError('HUB_SHUTDOWN', '任务已取消', false));
      }
      void proc.managed.exited.then((exit) => this.onProcessExit(exit));
      void proc.conn.closed.then(() => this.onConnClosed(proc.managed));
      const resumed = params.resumeNativeSessionId !== null;
      try {
        await this.createOrResume(proc);
        if (this.loggedOut) {
          host.setHealth({
            status: 'auth_required',
            message: this.names.authHint,
            version: proc.info.version,
          });
          throw new AgentFailure(agentError('AGENT_AUTH_REQUIRED', this.names.authHint, false));
        }
        await this.enterTargetMode();
      } catch (err) {
        await this.endProcess();
        if (params.signal.aborted)
          throw new AgentFailure(agentError('HUB_SHUTDOWN', '任务已取消', false));
        throw err;
      }
      if (!resumed) host.sessionCreated(this.state, proc.info);
      if (params.signal.aborted) {
        await this.endProcess();
        throw new AgentFailure(agentError('HUB_SHUTDOWN', '任务已取消', false));
      }
      this.sink.emit({
        type: 'session.started',
        nativeSessionId: this.sessionId!,
        model: currentModel(this.state),
        resumed,
      });
      if (host.healthStatus() !== 'ready') {
        host.setHealth({
          status: 'ready',
          version: proc.info.version,
          versionVerified:
            proc.info.version !== null && host.profile.verifiedVersions.includes(proc.info.version),
          executablePath: proc.executablePath,
        });
      }
    } finally {
      params.signal.removeEventListener('abort', onAbort);
    }
  }

  private async createOrResume(proc: AcpProcess): Promise<void> {
    const { cwd, resumeNativeSessionId } = this.params;
    if (resumeNativeSessionId === null) {
      try {
        const res = await acpRequest(proc.conn, 'session/new', { cwd, mcpServers: [] });
        this.sessionId = res.sessionId;
        this.state = configStateFrom(res);
      } catch (err) {
        throw this.startFailure(err, 'new', 'session/new');
      }
      return;
    }
    const via = proc.info.resume;
    if (via === null) {
      throw new AgentFailure(
        agentError(
          'SESSION_NOT_RESUMABLE',
          `${this.names.displayName} 不支持恢复会话，请新建任务`,
          false,
        ),
      );
    }
    this.sessionId = resumeNativeSessionId;
    const req = { sessionId: resumeNativeSessionId, cwd, mcpServers: [] };
    try {
      if (via === 'resume') {
        this.state = configStateFrom(await acpRequest(proc.conn, 'session/resume', req));
      } else {
        this.replaying = true;
        try {
          this.state = configStateFrom(await acpRequest(proc.conn, 'session/load', req));
        } finally {
          this.replaying = false;
        }
      }
    } catch (err) {
      throw this.startFailure(err, via, `session/${via}`);
    }
  }

  private startFailure(err: unknown, phase: 'new' | 'resume' | 'load', method: string): unknown {
    if (err instanceof JsonRpcError) return new AgentFailure(mapStartError(err, this.names, phase));
    if (err instanceof JsonRpcTimeoutError) return new AgentFailure(this.timeoutError(method));
    if (err instanceof JsonRpcClosedError) return new AgentFailure(this.exitedError());
    return err;
  }

  /** §4.3 第 6 步：记下目标模式与允许的模式，必要时切过去。 */
  private async enterTargetMode(): Promise<void> {
    const preferences = this.host.profile.modes[this.params.mode];
    this.targetMode = pickTargetMode(this.state, preferences);
    if (this.targetMode === null) {
      this.logger.warn(
        `${this.names.displayName} 没有可用的 ${preferences.join(' / ')} 模式，Hub 不管理会话模式`,
        { label: this.label },
      );
      return;
    }
    this.allowed = allowedModes(this.targetMode, this.host.profile.modes, this.params.mode);
    if (currentMode(this.state) === this.targetMode) return;
    const change = modeChange(this.state, this.sessionId!, this.targetMode);
    const failure = await this.apply(change);
    if (failure) throw new AgentFailure(this.configFailure(failure, change));
  }

  // ───────────────────────── 配置（§4.4） ─────────────────────────

  /** 发一个配置请求并更新 state；成功返回 null。 */
  private async apply(change: ConfigChange): Promise<RequestFailure | null> {
    const conn = this.proc?.conn;
    if (!conn?.isOpen) return { kind: 'closed' };
    try {
      switch (change.method) {
        case 'session/set_config_option': {
          const res = await acpRequest(conn, change.method, change.params);
          this.state = withConfigOptions(this.state, res.configOptions);
          break;
        }
        case 'session/set_mode':
          await acpRequest(conn, change.method, change.params);
          this.state = withCurrentMode(this.state, change.params.modeId);
          break;
        case 'session/set_model':
          await acpRequest(conn, change.method, change.params);
          this.state = withLegacyModel(this.state, change.params.modelId);
          break;
      }
      return null;
    } catch (err) {
      return this.classify(err, change.method);
    }
  }

  private classify(err: unknown, method: string): RequestFailure {
    if (err instanceof JsonRpcError) return { kind: 'rpc', error: err };
    if (err instanceof JsonRpcTimeoutError)
      return { kind: 'error', error: this.timeoutError(method) };
    if (err instanceof JsonRpcClosedError) return { kind: 'closed' };
    throw err;
  }

  private configFailure(failure: RequestFailure, change: ConfigChange): AgentError {
    switch (failure.kind) {
      case 'rpc':
        return mapConfigError(failure.error, this.names, change);
      case 'error':
        return failure.error;
      case 'closed':
        return this.exitedError();
    }
  }

  private timeoutError(method: string): AgentError {
    return agentError('AGENT_PROTOCOL_ERROR', `${this.names.displayName} 没有响应 ${method}`, true);
  }

  private exitedError(): AgentError {
    const code = this.exit ? (this.exit.code ?? this.exit.signal ?? '未知') : '未知';
    return agentError(
      'AGENT_PROCESS_EXITED',
      `${this.names.displayName} 进程意外退出（退出码 ${code}）`,
      true,
      this.exit ? toJsonValue({ exit: this.exit }) : undefined,
    );
  }

  /** §5 模式守卫：同一时刻只跑一个，进行中时再收到通知就等它结束后再查一次。 */
  private runModeGuard(): void {
    if (this.guardRunning) {
      this.guardAgain = true;
      return;
    }
    this.guardRunning = (async () => {
      do {
        this.guardAgain = false;
        await this.guardOnce();
      } while (this.guardAgain && !this.isClosed);
    })().finally(() => (this.guardRunning = null));
  }

  private async guardOnce(): Promise<void> {
    const target = this.targetMode;
    const mode = currentMode(this.state);
    if (target === null || this.sessionId === null || mode === null) return;
    if (this.allowed.includes(mode)) return;
    const change = modeChange(this.state, this.sessionId, target);
    const failure = await this.apply(change);
    if (!failure) {
      this.sink.emit({
        type: 'notice',
        level: 'warning',
        code: 'MODE_RESTORED',
        message: `${this.names.displayName} 切换到了“${mode}”模式，Hub 已切回“${target}”`,
      });
      return;
    }
    const error = this.configFailure(failure, change);
    this.logger.error(`${this.names.displayName} 模式守卫没能切回“${target}”`, {
      label: this.label,
      error: error.message,
    });
    const turn = this.turn;
    if (turn && !turn.done && failure.kind !== 'closed') {
      turn.fatal ??= error;
      await this.cancelTurn();
    }
  }

  // ───────────────────────── 一轮（§6） ─────────────────────────

  prompt(input: PromptInput): Promise<TurnResult> {
    if (this.isClosed || !this.proc?.conn.isOpen || this.sessionId === null) {
      return Promise.resolve({
        stopReason: 'error',
        error: agentError('AGENT_PROCESS_EXITED', `${this.names.displayName} 进程已退出`, true),
      });
    }
    return new Promise<TurnResult>((resolve) => {
      const turn: ActiveTurn = {
        turnId: input.turnId,
        index: input.index,
        mapper: new AcpTurnMapper(input.index),
        promptSent: false,
        cancelRequested: false,
        modeSwitchDeclined: false,
        fatal: null,
        approvals: new Map(),
        resolve,
        done: false,
      };
      this.turn = turn;
      void this.runTurn(turn, input).catch((err: unknown) => {
        this.logger.error('ACP 轮内程序错误', { label: this.label, error: String(err) });
        this.finishTurn(turn, {
          stopReason: 'error',
          error: agentError(
            'AGENT_PROTOCOL_ERROR',
            `${this.names.displayName} 请求失败：${String(err)}`,
            false,
          ),
        });
      });
    });
  }

  private async runTurn(turn: ActiveTurn, input: PromptInput): Promise<void> {
    const sessionId = this.sessionId!;
    // 第 3 步：模式。
    if (this.guardRunning) await this.guardRunning;
    const mode = currentMode(this.state);
    if (this.targetMode !== null && mode !== null && !this.allowed.includes(mode)) {
      const change = modeChange(this.state, sessionId, this.targetMode);
      if (!(await this.applyInTurn(turn, change))) return;
    }
    // 第 4 步：模型与推理档位（§4.5）。
    let aligned = false;
    for (let i = 0; i < MAX_TURN_CHANGES && !turn.done; i++) {
      const next = nextTurnChange(
        this.state,
        this.host.models(),
        { model: input.model, reasoningEffort: input.reasoningEffort },
        sessionId,
        this.names,
      );
      if (next === null) {
        aligned = true;
        break;
      }
      if (!('method' in next)) {
        this.finishTurn(turn, { stopReason: 'error', error: next });
        return;
      }
      if (!(await this.applyInTurn(turn, next))) return;
    }
    if (turn.done) return;
    if (!aligned) {
      this.logger.warn(`${this.names.displayName} 的模型配置没有收敛`, { label: this.label });
    }
    // 第 5 步。
    if (turn.cancelRequested) {
      this.finishTurn(turn, { stopReason: 'cancelled' });
      return;
    }
    // 第 6 步。
    const conn = this.proc!.conn;
    turn.promptSent = true;
    try {
      const res = await acpRequest(
        conn,
        'session/prompt',
        { sessionId, prompt: [{ type: 'text', text: input.text }] },
        null,
      );
      if (turn.done) return;
      if (turn.fatal) {
        this.finishTurn(turn, { stopReason: 'error', error: turn.fatal });
        return;
      }
      const { stopReason, notice } = turnStop(res.stopReason, {
        cancelRequested: turn.cancelRequested,
        modeSwitchDeclined: turn.modeSwitchDeclined,
      });
      if (notice) this.sink.emit(notice);
      this.finishTurn(turn, { stopReason });
    } catch (err) {
      if (turn.done) return;
      if (err instanceof JsonRpcClosedError) return; // 第 9 步：等 §8.3 的进程退出处理。
      if (err instanceof JsonRpcError) {
        const error = turn.fatal ?? mapPromptError(err, this.names);
        if (error.code === 'AGENT_AUTH_REQUIRED') {
          this.host.setHealth({
            status: 'auth_required',
            message: this.names.authHint,
            version: this.proc?.info.version ?? null,
          });
        }
        this.finishTurn(turn, { stopReason: 'error', error });
        return;
      }
      throw err;
    }
  }

  /** 轮内的配置请求：失败时结束本轮（连接关闭时等进程退出处理），返回 false。 */
  private async applyInTurn(turn: ActiveTurn, change: ConfigChange): Promise<boolean> {
    const failure = await this.apply(change);
    if (turn.done) return false;
    if (!failure) return true;
    if (failure.kind === 'closed') return false;
    this.finishTurn(turn, { stopReason: 'error', error: this.configFailure(failure, change) });
    return false;
  }

  /** 结束本轮（幂等）：补齐事件、撤回未决审批、resolve prompt()。 */
  private finishTurn(turn: ActiveTurn, result: TurnResult): void {
    if (turn.done) return;
    turn.done = true;
    for (const event of turn.mapper.finish()) this.sink.emit(event);
    for (const pending of turn.approvals.values()) pending.controller.abort();
    if (this.turn === turn) this.turn = null;
    turn.resolve(result);
  }

  // ───────────────────────── 取消、释放、退出（§8） ─────────────────────────

  async cancelTurn(): Promise<void> {
    const turn = this.turn;
    if (!turn || turn.done || turn.cancelRequested) return;
    turn.cancelRequested = true;
    if (turn.promptSent) this.sendCancel();
    for (const pending of turn.approvals.values()) pending.controller.abort();
  }

  private sendCancel(): void {
    const conn = this.proc?.conn;
    if (conn?.isOpen && this.sessionId)
      conn.notify(ACP_CANCEL_METHOD, { sessionId: this.sessionId });
  }

  dispose(reason: DisposeReason): Promise<void> {
    this.disposing ??= this.doDispose(reason);
    return this.disposing;
  }

  private async doDispose(reason: DisposeReason): Promise<void> {
    const conn = this.proc?.conn;
    const turn = this.turn;
    if (turn && !turn.done) {
      if (conn?.isOpen && turn.promptSent) this.sendCancel();
      this.finishTurn(turn, this.disposeResult(reason));
    }
    if (conn?.isOpen && this.proc?.info.close && reason !== 'agent_exited' && this.sessionId) {
      await acpRequest(
        conn,
        'session/close',
        { sessionId: this.sessionId },
        CLOSE_TIMEOUT_MS,
      ).catch((err: unknown) =>
        this.logger.debug('session/close 失败', { label: this.label, error: String(err) }),
      );
    }
    await this.endProcess(reason === 'shutdown');
    this.isClosed = true;
    this.host.release(this);
    this.resolveClosed();
  }

  /** 接口 §6.1 规则 5：释放原因 → 进行中的轮的结果。 */
  private disposeResult(reason: DisposeReason): TurnResult {
    switch (reason) {
      case 'shutdown':
        return {
          stopReason: 'error',
          error: agentError('HUB_SHUTDOWN', 'Agent Hub 正在退出', true),
        };
      case 'agent_exited':
        return { stopReason: 'error', error: this.exitedError() };
      default:
        return { stopReason: 'cancelled' };
    }
  }

  private async endProcess(shutdown = false): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    proc.conn.close();
    await proc.managed.terminate(shutdown ? SHUTDOWN_TERMINATE : undefined);
  }

  private onProcessExit(exit: ExitInfo): void {
    this.exit = exit;
    if (this.disposing) return;
    this.logger.warn(`${this.names.displayName} 进程退出`, {
      label: this.label,
      code: exit.code,
      signal: exit.signal,
      stderr: this.proc?.managed.stderrTail(),
    });
    void this.dispose('agent_exited');
  }

  private onConnClosed(managed: ManagedProcess): void {
    if (this.disposing || this.exit) return;
    const timer = setTimeout(() => {
      if (!this.exit) void managed.terminate();
    }, CONN_CLOSED_GRACE_MS);
    timer.unref();
  }

  private get label(): string {
    return `acp:${this.host.config.id}:${this.params.shortId}`;
  }

  // ───────────────────────── Agent 发来的消息（§6.2、§7） ─────────────────────────

  private onNotification(method: string, params: unknown): void {
    switch (method) {
      case ACP_UPDATE_METHOD:
        this.onUpdate(params as SessionNotification);
        return;
      case ACP_CANCEL_REQUEST_METHOD: {
        const requestId = (params as { requestId?: JsonRpcId } | null)?.requestId;
        const pending = requestId === undefined ? undefined : this.turn?.approvals.get(requestId);
        if (pending) {
          pending.cancelledByAgent = true;
          pending.controller.abort();
        }
        return;
      }
      case ACP_AUTH_STATUS_METHOD:
        if (isLoggedOutStatus(params)) this.loggedOut = true;
        return;
      default:
        return;
    }
  }

  private onUpdate(params: SessionNotification): void {
    if (this.sessionId === null || params?.sessionId !== this.sessionId) {
      this.logger.debug('忽略其他会话的 session/update', { label: this.label });
      return;
    }
    if (this.replaying) return;
    const update = params.update;
    if (update.sessionUpdate === 'config_option_update') {
      this.state = withConfigOptions(this.state, update.configOptions);
      this.runModeGuard();
      return;
    }
    if (update.sessionUpdate === 'current_mode_update') {
      this.state = withCurrentMode(this.state, update.currentModeId);
      this.runModeGuard();
      return;
    }
    const turn = this.turn;
    if (!turn || turn.done) {
      this.logger.debug('轮外的 session/update 已丢弃', {
        label: this.label,
        sessionUpdate: update.sessionUpdate,
      });
      return;
    }
    for (const event of turn.mapper.map(update)) this.sink.emit(event);
  }

  private onRequest(method: string, params: unknown, id: JsonRpcId): unknown {
    if (method === ACP_PERMISSION_METHOD)
      return this.onPermission(params as RequestPermissionRequest, id);
    throw new JsonRpcError(ACP_ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }

  /** §7.1。 */
  private async onPermission(
    req: RequestPermissionRequest,
    id: JsonRpcId,
  ): Promise<RequestPermissionResponse> {
    const turn = this.turn;
    if (this.sessionId === null || req?.sessionId !== this.sessionId || !turn || turn.done) {
      this.logger.warn('轮外或其他会话的权限请求，回复 cancelled', { label: this.label });
      return { outcome: { outcome: 'cancelled' } };
    }
    for (const event of turn.mapper.map({ sessionUpdate: 'tool_call_update', ...req.toolCall }))
      this.sink.emit(event);
    const toolCallId = req.toolCall.toolCallId;
    if (this.params.mode === 'read_only' && isModeSwitchRequest(req)) {
      turn.mapper.markDeclined(toolCallId);
      turn.modeSwitchDeclined = true;
      return permissionResponse('reject', req.options);
    }
    const pending: PendingApproval = { controller: new AbortController(), cancelledByAgent: false };
    turn.approvals.set(id, pending);
    let outcome;
    try {
      outcome = await this.sink.requestApproval(
        approvalFromPermission(req, this.params.cwd),
        pending.controller.signal,
      );
    } finally {
      turn.approvals.delete(id);
    }
    if ('withdrawn' in outcome) {
      if (pending.cancelledByAgent)
        throw new JsonRpcError(ACP_ERROR.REQUEST_CANCELLED, 'Request cancelled');
      return { outcome: { outcome: 'cancelled' } };
    }
    if (outcome.decision === 'reject' || outcome.decision === 'cancel_turn')
      turn.mapper.markDeclined(toolCallId);
    return permissionResponse(outcome.decision, req.options);
  }
}

export type { AgentCapabilities, TaskMode };
