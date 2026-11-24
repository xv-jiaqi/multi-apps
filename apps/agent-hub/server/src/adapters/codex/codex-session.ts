import type { AgentError, ModelOption, UsageInfo } from '@agent-hub/contract';
import { JsonRpcClosedError, JsonRpcError, NO_RESPONSE } from '../jsonrpc/connection';
import type { JsonRpcConnection } from '../jsonrpc/connection';
import {
  agentError,
  type AdapterLogger,
  type AgentEventSink,
  type AgentSession,
  type ApprovalOutcome,
  type ApprovalRequestInput,
  type DisposeReason,
  type PromptInput,
  type TurnResult,
} from '../types';
import {
  approvalForCommand,
  approvalForFileChange,
  approvalForPermissions,
  decisionToWire,
  isAuthFailure,
  mapItemCompleted,
  mapItemStarted,
  mapPlan,
  mapTokenUsage,
  mapTurnCompleted,
  mapTurnError,
  permissionsResponse,
  resolveTurnModel,
  sandboxFor,
} from './mapping';
import type {
  CodexTurn,
  CommandExecutionRequestApprovalParams,
  DeltaNotification,
  ErrorNotification,
  FileChangeRequestApprovalParams,
  ItemNotification,
  ModelReroutedNotification,
  PermissionsRequestApprovalParams,
  ServerRequestResolvedNotification,
  ThreadTokenUsageUpdatedNotification,
  TurnNotification,
  TurnPlanUpdatedNotification,
  TurnStartParams,
  TurnStartResponse,
  WarningNotification,
} from './protocol';
import type { TaskMode } from '@agent-hub/contract';

interface OpenItem {
  kind: 'message' | 'reasoning' | 'tool';
  text: string;
}

interface ActiveTurn {
  turnId: string;
  nativeTurnId: string | null;
  fatal: AgentError | null;
  cancelRequested: boolean;
  items: Map<string, OpenItem>;
  approvals: Set<AbortController>;
  resolve: (r: TurnResult) => void;
  done: boolean;
  usage: UsageInfo | null;
}

interface PendingServerRequest {
  controller: AbortController;
  resolvedByServer: boolean;
}

export interface CodexSessionHost {
  conn(): JsonRpcConnection | null;
  models(): ModelOption[];
  reportAuthRequired(message: string): void;
  release(threadId: string): void;
  logger: AdapterLogger;
}

/** adapter-codex.md §5–§7：一个 thread 的轮、事件、审批、取消、释放。 */
export class CodexSession implements AgentSession {
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private active: ActiveTurn | null = null;
  private disposing: Promise<void> | null = null;
  private isClosed = false;
  private readonly filePaths = new Map<string, string[]>();
  private readonly serverRequests = new Map<string | number, PendingServerRequest>();

  constructor(
    readonly nativeSessionId: string,
    private readonly cwd: string,
    private readonly mode: TaskMode,
    private readonly sink: AgentEventSink,
    private readonly host: CodexSessionHost,
  ) {
    this.closed = new Promise((r) => (this.resolveClosed = r));
  }

  prompt(input: PromptInput): Promise<TurnResult> {
    const conn = this.host.conn();
    if (this.isClosed || !conn) {
      return Promise.resolve({
        stopReason: 'error',
        error: agentError('AGENT_PROCESS_EXITED', 'Codex 进程已退出', true),
      });
    }
    return new Promise<TurnResult>((resolve) => {
      const turn: ActiveTurn = {
        turnId: input.turnId,
        nativeTurnId: null,
        fatal: null,
        cancelRequested: false,
        items: new Map(),
        approvals: new Set(),
        resolve,
        done: false,
        usage: null,
      };
      this.active = turn;
      const params: TurnStartParams = {
        threadId: this.nativeSessionId,
        input: [{ type: 'text', text: input.text, text_elements: [] }],
        cwd: this.cwd,
        approvalPolicy: 'on-request',
        sandboxPolicy: sandboxFor(this.mode, this.cwd).sandboxPolicy,
        ...resolveTurnModel(this.host.models(), input.model, input.reasoningEffort),
        summary: 'auto',
      };
      conn
        .request<TurnStartResponse>('turn/start', params)
        .then((res) => {
          if (turn.done) return;
          turn.nativeTurnId ??= res.turn.id;
          if (turn.cancelRequested) this.interrupt(turn);
        })
        .catch((err: unknown) => {
          if (turn.done) return;
          if (err instanceof JsonRpcClosedError) return; // 等进程退出处理（§7.3）
          const message = err instanceof Error ? err.message : String(err);
          this.finish(turn, {
            stopReason: 'error',
            error: agentError(
              'AGENT_PROTOCOL_ERROR',
              `Codex 拒绝了本轮请求：${message}`,
              false,
              err instanceof JsonRpcError ? { code: err.code, message: err.message } : undefined,
            ),
          });
        });
    });
  }

  async cancelTurn(): Promise<void> {
    const turn = this.active;
    if (!turn || turn.done) return;
    turn.cancelRequested = true;
    for (const c of turn.approvals) c.abort();
    if (turn.nativeTurnId) this.interrupt(turn);
  }

  dispose(reason: DisposeReason): Promise<void> {
    this.disposing ??= (async () => {
      const conn = this.host.conn();
      const turn = this.active;
      if (turn && !turn.done) {
        if (conn?.isOpen && turn.nativeTurnId) this.interrupt(turn);
        const result: TurnResult =
          reason === 'agent_exited'
            ? {
                stopReason: 'error',
                error: agentError('AGENT_PROCESS_EXITED', 'Codex 进程已退出', true),
              }
            : { stopReason: 'cancelled' };
        this.finish(turn, result);
      }
      for (const pending of this.serverRequests.values()) pending.controller.abort();
      if (conn?.isOpen && reason !== 'agent_exited') {
        await conn
          .request('thread/unsubscribe', { threadId: this.nativeSessionId }, { timeoutMs: 5000 })
          .catch((e: unknown) =>
            this.host.logger.warn('thread/unsubscribe 失败', { error: String(e) }),
          );
      }
      this.isClosed = true;
      this.host.release(this.nativeSessionId);
      this.resolveClosed();
    })();
    return this.disposing;
  }

  // ---- 来自 CodexAdapter 的分发 ----

  onNotification(method: string, params: Record<string, unknown>): void {
    const turn = this.active;
    if (method === 'thread/closed') {
      void this.dispose('agent_exited');
      return;
    }
    if (method === 'serverRequest/resolved') {
      const p = params as unknown as ServerRequestResolvedNotification;
      const pending = this.serverRequests.get(p.requestId);
      if (pending) {
        pending.resolvedByServer = true;
        pending.controller.abort();
      }
      return;
    }
    if (method === 'warning') {
      const p = params as unknown as WarningNotification;
      this.sink.emit({
        type: 'notice',
        level: 'warning',
        code: 'AGENT_WARNING',
        message: `Codex：${p.message}`,
      });
      return;
    }
    if (!turn || turn.done) return;
    const nativeId =
      typeof params.turnId === 'string'
        ? params.turnId
        : ((params.turn as CodexTurn | undefined)?.id ?? null);
    if (nativeId) {
      turn.nativeTurnId ??= nativeId;
      if (turn.nativeTurnId !== nativeId) {
        this.host.logger.debug('忽略其他轮的通知', { method, nativeId });
        return;
      }
      if (turn.cancelRequested && method === 'turn/started') this.interrupt(turn);
    }
    switch (method) {
      case 'turn/started':
        return;
      case 'item/started': {
        const { item } = params as unknown as ItemNotification;
        if (item.type === 'fileChange')
          this.filePaths.set(
            item.id,
            item.changes.map((c) => c.path),
          );
        const ev = mapItemStarted(item);
        if (ev) {
          turn.items.set(item.id, { kind: 'tool', text: '' });
          this.sink.emit(ev);
        }
        return;
      }
      case 'item/completed': {
        const { item } = params as unknown as ItemNotification;
        turn.items.delete(item.id);
        const ev = mapItemCompleted(item);
        if (ev) this.sink.emit(ev);
        return;
      }
      case 'item/agentMessage/delta':
        return this.delta(turn, params, 'message', 'message.delta');
      case 'item/reasoning/summaryTextDelta':
        return this.delta(turn, params, 'reasoning', 'reasoning.delta');
      case 'item/commandExecution/outputDelta':
      case 'item/fileChange/outputDelta':
        return this.delta(turn, params, 'tool', 'tool.output.delta');
      case 'turn/plan/updated':
        this.sink.emit(mapPlan(params as unknown as TurnPlanUpdatedNotification));
        return;
      case 'thread/tokenUsage/updated':
        turn.usage = mapTokenUsage(params as unknown as ThreadTokenUsageUpdatedNotification);
        this.sink.emit({ type: 'usage.updated', usage: turn.usage });
        return;
      case 'error': {
        const p = params as unknown as ErrorNotification;
        if (p.willRetry && isAuthFailure(p.error)) {
          turn.fatal = mapTurnError(p.error);
          this.host.reportAuthRequired(turn.fatal.message);
          this.interrupt(turn);
        } else if (p.willRetry) {
          this.sink.emit({
            type: 'notice',
            level: 'warning',
            code: 'AGENT_RETRYING',
            message: `Codex 正在重试：${p.error.message}`,
          });
        } else {
          turn.fatal = mapTurnError(p.error);
          if (turn.fatal.code === 'AGENT_AUTH_REQUIRED')
            this.host.reportAuthRequired(turn.fatal.message);
        }
        return;
      }
      case 'model/rerouted': {
        const p = params as unknown as ModelReroutedNotification;
        this.sink.emit({
          type: 'notice',
          level: 'warning',
          code: 'MODEL_REROUTED',
          message: `Codex 把本轮的模型从 ${p.fromModel} 换成了 ${p.toModel}`,
        });
        return;
      }
      case 'turn/completed': {
        const p = params as unknown as TurnNotification;
        this.finish(turn, mapTurnCompleted(p.turn, turn.fatal));
        return;
      }
      default:
        return;
    }
  }

  async onServerRequest(
    method: string,
    params: Record<string, unknown>,
    id: string | number,
  ): Promise<unknown> {
    let input: ApprovalRequestInput;
    let reply: (o: ApprovalOutcome) => unknown;
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const p = params as unknown as CommandExecutionRequestApprovalParams;
        input = approvalForCommand(p);
        reply = (o) => ({ decision: 'decision' in o ? decisionToWire(o.decision) : 'cancel' });
        break;
      }
      case 'item/fileChange/requestApproval': {
        const p = params as unknown as FileChangeRequestApprovalParams;
        input = approvalForFileChange(p, this.filePaths.get(p.itemId));
        reply = (o) => ({ decision: 'decision' in o ? decisionToWire(o.decision) : 'cancel' });
        break;
      }
      case 'item/permissions/requestApproval': {
        const p = params as unknown as PermissionsRequestApprovalParams;
        input = approvalForPermissions(p);
        reply = (o) =>
          'decision' in o ? permissionsResponse(p, o.decision) : { permissions: {}, scope: 'turn' };
        break;
      }
      case 'item/tool/requestUserInput':
        this.sink.emit({
          type: 'notice',
          level: 'warning',
          code: 'USER_INPUT_UNSUPPORTED',
          message: 'Codex 请求用户输入，Hub 暂不支持，已回空答案',
        });
        return { answers: {} };
      case 'mcpServer/elicitation/request':
        this.sink.emit({
          type: 'notice',
          level: 'warning',
          code: 'ELICITATION_DECLINED',
          message: 'Codex 的 MCP 服务请求补充信息，Hub 已拒绝',
        });
        return { action: 'decline', content: null, _meta: null };
      default:
        throw new JsonRpcError(-32601, `Method not found: ${method}`);
    }
    const controller = new AbortController();
    const pending: PendingServerRequest = { controller, resolvedByServer: false };
    this.serverRequests.set(id, pending);
    const turn = this.active;
    turn?.approvals.add(controller);
    if (!turn || turn.done) controller.abort();
    try {
      const outcome = await this.sink.requestApproval(input, controller.signal);
      if ('withdrawn' in outcome && pending.resolvedByServer) return NO_RESPONSE;
      if ('decision' in outcome && outcome.decision === 'cancel_turn') void this.cancelTurn();
      return reply(outcome);
    } finally {
      turn?.approvals.delete(controller);
      this.serverRequests.delete(id);
    }
  }

  private delta(
    turn: ActiveTurn,
    params: Record<string, unknown>,
    kind: OpenItem['kind'],
    type: 'message.delta' | 'reasoning.delta' | 'tool.output.delta',
  ): void {
    const p = params as unknown as DeltaNotification;
    const open = turn.items.get(p.itemId) ?? { kind, text: '' };
    open.text += p.delta;
    turn.items.set(p.itemId, open);
    this.sink.emit({ type, itemId: p.itemId, text: p.delta });
  }

  private interrupt(turn: ActiveTurn): void {
    const conn = this.host.conn();
    if (!conn?.isOpen || !turn.nativeTurnId) return;
    conn
      .request('turn/interrupt', { threadId: this.nativeSessionId, turnId: turn.nativeTurnId })
      .catch((e: unknown) => this.host.logger.warn('turn/interrupt 失败', { error: String(e) }));
  }

  /** §5.4 结束本轮。 */
  private finish(turn: ActiveTurn, result: TurnResult): void {
    if (turn.done) return;
    turn.done = true;
    for (const [itemId, item] of turn.items) {
      if (item.kind === 'message')
        this.sink.emit({ type: 'message.completed', itemId, text: item.text });
      else if (item.kind === 'reasoning') {
        if (item.text) this.sink.emit({ type: 'reasoning.completed', itemId, text: item.text });
      } else this.sink.emit({ type: 'tool.completed', itemId, status: 'failed' });
    }
    turn.items.clear();
    for (const c of turn.approvals) c.abort();
    if (this.active === turn) this.active = null;
    turn.resolve({
      ...result,
      ...(turn.nativeTurnId && !result.nativeTurnId ? { nativeTurnId: turn.nativeTurnId } : {}),
      ...(turn.usage && !result.usage ? { usage: turn.usage } : {}),
    });
  }
}
