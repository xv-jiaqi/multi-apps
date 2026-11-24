import { Inject, Injectable } from '@nestjs/common';
import type {
  AgentError,
  AgentEvent,
  CoreEvent,
  StopReason,
  TaskStatus,
  TurnStatus,
} from '@agent-hub/contract';
import { isTerminalStatus } from '@agent-hub/contract';
import { AgentFailure, agentError, type AgentSession } from '../adapters/types';
import type { HubLogger } from '../common/logger';
import { HUB_DB, HUB_GIT, HUB_LOGGER, GIT_GUARD } from '../common/tokens';
import { HubConfigService } from '../config/config.service';
import { taskToDto, TasksRepo, type TaskRow, type TurnRow } from '../db/repositories/tasks.repo';
import type { Db } from '../db/sqlite';
import { diffTrees } from '../workspace/diff';
import type { Git } from '../workspace/git';
import type { GitGuard } from '../workspace/git-guard';
import { snapshotTree } from '../workspace/snapshot';
import { ensureWorktree, resolveBase, taskBranch, worktreePath } from '../workspace/worktree';
import { HUB_PATHS, type HubPaths } from '../common/paths';
import { AdapterRegistry } from './adapter-registry';
import { ApprovalService } from './approval.service';
import { EventBus } from './event-bus';
import { EventStore } from './event-store';
import { assertTransition } from './state-machine';

interface Active {
  session: AgentSession;
  idleTimer: NodeJS.Timeout | null;
}

interface Running {
  turnId: string;
  abort: AbortController;
  session: AgentSession | null;
  done: Promise<void>;
}

const CANCEL_WAIT_MS = 10_000;

/** architecture.md §5：一轮的完整流程。 */
@Injectable()
export class TaskRunner {
  private readonly repo: TasksRepo;
  private readonly sessions = new Map<string, Active>();
  private readonly running = new Map<string, Running>();
  onSlotFreed: () => void = () => {};

  constructor(
    @Inject(HUB_DB) private readonly db: Db,
    @Inject(HUB_GIT) private readonly git: Git,
    @Inject(GIT_GUARD) private readonly guard: GitGuard,
    @Inject(HUB_LOGGER) private readonly logger: HubLogger,
    @Inject(HUB_PATHS) private readonly paths: HubPaths,
    private readonly config: HubConfigService,
    private readonly registry: AdapterRegistry,
    private readonly events: EventStore,
    private readonly bus: EventBus,
    private readonly approvals: ApprovalService,
  ) {
    this.repo = new TasksRepo(db);
  }

  isActive(taskId: string): boolean {
    return this.running.has(taskId);
  }

  activeCount(): number {
    return this.running.size;
  }

  /** 调度器拿到槽位后调用；不 await 整轮。 */
  start(task: TaskRow, turn: TurnRow): void {
    const abort = new AbortController();
    const entry: Running = { turnId: turn.id, abort, session: null, done: Promise.resolve() };
    this.running.set(task.id, entry);
    this.transition(task.id, 'queued', 'preparing', turn.id);
    entry.done = this.runTurn(task.id, turn.id, entry)
      .catch((err: unknown) => {
        this.logger.errorMsg('TaskRunner 未预料的异常', {
          taskId: task.id,
          error: String(err),
          stack: (err as Error)?.stack,
        });
        this.failTurn(
          task.id,
          turn.id,
          agentError('INTERNAL', 'Agent Hub 内部错误，详见日志', false),
        );
      })
      .finally(() => {
        this.running.delete(task.id);
        this.onSlotFreed();
      });
  }

  async cancel(taskId: string, force: boolean): Promise<void> {
    const r = this.running.get(taskId);
    if (!r) return;
    r.abort.abort();
    if (!r.session) return; // preparing：abort 生效
    const forceDispose = async () => {
      await r.session?.dispose('cancelled');
      this.sessions.delete(taskId);
    };
    if (force) {
      await forceDispose();
      return;
    }
    await r.session.cancelTurn();
    const timer = new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), CANCEL_WAIT_MS));
    if ((await Promise.race([r.done.then(() => 'done' as const), timer])) === 'timeout')
      await forceDispose();
  }

  async shutdown(): Promise<void> {
    this.approvals.expireAll();
    await Promise.all([...this.running.keys()].map((id) => this.cancel(id, true)));
    for (const a of this.sessions.values()) if (a.idleTimer) clearTimeout(a.idleTimer);
    this.events.flushAll();
  }

  /** GET /tasks/:id/diff?live=true：现场快照，不写轮记录。 */
  async liveDiff(task: TaskRow) {
    const cwd = task.workspace_path ?? task.repo_path;
    const now = await snapshotTree(this.git, cwd);
    return diffTrees(this.git, cwd, task.base_tree ?? now, now);
  }

  // ---- 内部 ----

  private async runTurn(taskId: string, turnId: string, entry: Running): Promise<void> {
    const signal = entry.abort.signal;
    let task = this.repo.task(taskId)!;
    const turn = this.repo.turn(turnId)!;
    const agent = this.registry.get(task.agent_id);
    if (!agent?.adapter || !agent.config.enabled) {
      return this.failTurn(
        taskId,
        turnId,
        agentError('AGENT_DISABLED', `Agent ${task.agent_id} 不可用或已禁用`, false),
      );
    }

    // 2. 工作区
    let cwd: string;
    try {
      cwd = await this.prepareWorkspace(task);
    } catch (err) {
      if (signal.aborted) return this.cancelledBeforeRun(taskId, turnId);
      return this.failTurn(
        taskId,
        turnId,
        agentError('WORKSPACE_SETUP_FAILED', `准备工作区失败：${(err as Error).message}`, false),
      );
    }
    if (signal.aborted) return this.cancelledBeforeRun(taskId, turnId);
    task = this.repo.task(taskId)!;

    // 3. 会话
    let session = this.sessions.get(taskId)?.session ?? null;
    if (session) this.clearIdle(taskId);
    if (!session) {
      try {
        session = await agent.adapter.startSession(
          {
            taskId,
            shortId: task.short_id,
            cwd,
            mode: task.mode as 'read_only' | 'write',
            workspace: task.workspace_kind as 'in_place' | 'worktree',
            resumeNativeSessionId: task.native_session_id,
            userVisible: task.user_visible === 1,
            remote: null,
            signal,
          },
          this.sinkFor(taskId, () => this.running.get(taskId)?.turnId ?? null),
        );
      } catch (err) {
        if (signal.aborted) return this.cancelledBeforeRun(taskId, turnId);
        const error =
          err instanceof AgentFailure
            ? err.error
            : agentError('INTERNAL', 'Agent Hub 内部错误，详见日志', false);
        if (!(err instanceof AgentFailure))
          this.logger.errorMsg('startSession 异常', { error: String(err) });
        return this.failTurn(taskId, turnId, error);
      }
      this.sessions.set(taskId, { session, idleTimer: null });
      this.repo.updateTask(taskId, { native_session_id: session.nativeSessionId });
      void session.closed.then(() => {
        if (this.sessions.get(taskId)?.session === session) this.sessions.delete(taskId);
      });
    }
    entry.session = session;
    if (signal.aborted) return this.cancelledBeforeRun(taskId, turnId);

    // 4. 轮前快照
    let beforeTree: string;
    try {
      beforeTree = await snapshotTree(this.git, cwd);
    } catch (err) {
      return this.failTurn(
        taskId,
        turnId,
        agentError('GIT_ERROR', `轮前快照失败：${(err as Error).message}`, true),
      );
    }
    const blockedBefore = this.guard.blockedCount();

    // 5. running
    const startedAt = new Date().toISOString();
    this.repo.updateTurn(turnId, {
      status: 'running',
      before_tree: beforeTree,
      started_at: startedAt,
    });
    this.transition(taskId, 'preparing', 'running', turnId, {
      started_at: task.started_at ?? startedAt,
    });
    this.appendCore(taskId, turnId, {
      type: 'turn.started',
      turnId,
      index: turn.idx,
      prompt: turn.prompt,
      model: turn.model,
      reasoningEffort: turn.reasoning_effort,
    });

    // 6. prompt
    const result = await session.prompt({
      turnId,
      index: turn.idx,
      text: turn.prompt,
      model: turn.model,
      reasoningEffort: turn.reasoning_effort,
    });
    this.approvals.withdrawAll(turnId);

    // 7. 轮后：本轮输出都结束了，扣住的尾巴一起放出来。
    this.events.flush(taskId, 'all');
    let diffError: AgentError | null = null;
    try {
      const afterTree = await snapshotTree(this.git, cwd);
      const baseTree = this.repo.task(taskId)!.base_tree ?? beforeTree;
      const turnDiff = await diffTrees(this.git, cwd, beforeTree, afterTree);
      const taskDiff = await diffTrees(this.git, cwd, baseTree, afterTree);
      this.repo.updateTurn(turnId, {
        after_tree: afterTree,
        turn_patch: turnDiff.patch,
        task_patch: taskDiff.patch,
        turn_stats: JSON.stringify(turnDiff.stats),
        task_stats: JSON.stringify(taskDiff.stats),
        patch_truncated: turnDiff.truncated || taskDiff.truncated ? 1 : 0,
      });
      this.appendCore(taskId, turnId, {
        type: 'diff.updated',
        turnId,
        scope: 'turn_end',
        task: taskDiff.stats,
        turn: turnDiff.stats,
        patchTruncated: turnDiff.truncated || taskDiff.truncated,
      });
      if (task.mode === 'read_only' && beforeTree !== afterTree) {
        this.repo.updateTask(taskId, { read_only_violation: 1 });
        this.appendAgent(taskId, turnId, {
          type: 'notice',
          level: 'error',
          code: 'READ_ONLY_VIOLATION',
          message: '只读任务的工作区在本轮有改动',
        });
      }
    } catch (err) {
      diffError = agentError('GIT_ERROR', `轮后快照或 diff 失败：${(err as Error).message}`, true);
    }
    if (this.guard.blockedCount() > blockedBefore) {
      this.appendAgent(taskId, turnId, {
        type: 'notice',
        level: 'error',
        code: 'GIT_PUSH_BLOCKED',
        message: '本轮有 git push 被推送守卫拦截',
      });
    }

    const stopReason: StopReason =
      diffError && result.stopReason !== 'error' ? 'error' : result.stopReason;
    const error = result.error ?? diffError ?? undefined;
    let turnStatus: TurnStatus;
    let taskStatus: TaskStatus;
    if (stopReason === 'cancelled') {
      turnStatus = 'cancelled';
      taskStatus = 'cancelled';
    } else if (stopReason === 'error' && error?.code === 'AGENT_PROCESS_EXITED') {
      turnStatus = 'interrupted';
      taskStatus = 'interrupted';
    } else if (stopReason === 'error') {
      turnStatus = 'failed';
      taskStatus = 'failed';
    } else {
      turnStatus = 'completed';
      taskStatus = 'completed';
    }
    if (['max_tokens', 'max_turn_requests', 'refusal'].includes(stopReason)) {
      this.appendAgent(taskId, turnId, {
        type: 'notice',
        level: 'warning',
        code: stopReason.toUpperCase(),
        message: `本轮提前结束：${stopReason}`,
      });
    }
    const finalMessage = this.lastMessage(taskId, turnId);
    this.repo.updateTurn(turnId, {
      status: turnStatus,
      stop_reason: stopReason,
      error: error ? JSON.stringify(error) : null,
      native_turn_id: result.nativeTurnId ?? null,
      usage: result.usage ? JSON.stringify(result.usage) : undefined,
      final_message: finalMessage,
      ended_at: new Date().toISOString(),
    });
    this.appendCore(taskId, turnId, {
      type: 'turn.completed',
      turnId,
      index: turn.idx,
      status: turnStatus,
      stopReason,
      ...(error ? { error } : {}),
    });
    this.transition(taskId, 'running', taskStatus, turnId, {
      ended_at: new Date().toISOString(),
      last_error: error ? JSON.stringify(error) : null,
    });

    // 8. 闲置计时
    if (this.sessions.get(taskId)?.session === session)
      this.armIdle(
        taskId,
        'idleTimeoutMinutes' in agent.config ? agent.config.idleTimeoutMinutes : 30,
      );
  }

  private async prepareWorkspace(task: TaskRow): Promise<string> {
    if (task.base_tree) return task.workspace_path ?? task.repo_path;
    const repo = this.config.get().repos.find((r) => r.id === task.repo_id);
    const baseCommit = await resolveBase(
      this.git,
      task.repo_path,
      task.base_ref ?? repo?.defaultBaseRef ?? null,
    );
    let cwd = task.repo_path;
    let branch: string | null = null;
    if (task.workspace_kind === 'worktree') {
      cwd = worktreePath(this.paths.worktrees, task.repo_id, task.short_id);
      await ensureWorktree(this.git, task.repo_path, cwd, task.short_id, baseCommit);
      branch = taskBranch(task.short_id);
    } else if (task.workspace_kind !== 'in_place') {
      throw new Error(`本版本不支持工作区 ${task.workspace_kind}`);
    }
    const baseTree = await snapshotTree(this.git, cwd);
    await this.git.run(task.repo_path, [
      'update-ref',
      `refs/agent-hub/base/${task.short_id}`,
      baseTree,
    ]);
    this.repo.updateTask(task.id, {
      workspace_path: cwd,
      branch,
      base_commit: baseCommit,
      base_tree: baseTree,
    });
    return cwd;
  }

  private sinkFor(taskId: string, currentTurn: () => string | null) {
    return {
      emit: (event: AgentEvent) => this.appendAgent(taskId, currentTurn(), event),
      requestApproval: (input: Parameters<ApprovalService['request']>[2], signal: AbortSignal) => {
        const turnId = currentTurn();
        if (!turnId) {
          const fallback = input.options.includes('reject') ? 'reject' : input.options[0]!;
          return Promise.resolve({ decision: fallback });
        }
        return this.approvals.request(taskId, turnId, input, signal);
      },
      raw: () => {},
    };
  }

  private appendAgent(taskId: string, turnId: string | null, event: AgentEvent): void {
    this.events.append(taskId, turnId, event);
  }

  private appendCore(taskId: string, turnId: string | null, event: CoreEvent): void {
    this.events.append(taskId, turnId, event);
  }

  /** 迁移状态：同一事务写 status 与 task.status 事件（§3.1）。 */
  transition(
    taskId: string,
    from: TaskStatus,
    to: TaskStatus,
    turnId: string | null,
    extra: Record<string, string | number | null | undefined> = {},
  ): void {
    assertTransition(from, to);
    this.events.flush(taskId, isTerminalStatus(to) ? 'all' : undefined);
    const env = this.db.tx(() => {
      const cur = this.repo.task(taskId)!;
      if (cur.status !== from) assertTransition(cur.status as TaskStatus, to);
      this.repo.updateTask(taskId, { status: to, ...extra });
      return this.events.persistInTx(taskId, turnId, {
        type: 'task.status',
        from: cur.status as TaskStatus,
        to,
      });
    });
    this.events.publish(env);
    // 终态：放掉这个任务在 EventStore 里的计数与扣留（PR3 待办 1）；追问时会重新建。
    if (isTerminalStatus(to)) this.events.forgetTask(taskId);
    this.bus.publishTask(taskToDto(this.repo.task(taskId)!));
  }

  private failTurn(taskId: string, turnId: string, error: AgentError): void {
    const task = this.repo.task(taskId)!;
    this.repo.updateTurn(turnId, {
      status: 'failed',
      stop_reason: 'error',
      error: JSON.stringify(error),
      ended_at: new Date().toISOString(),
    });
    const turn = this.repo.turn(turnId)!;
    this.appendCore(taskId, turnId, {
      type: 'turn.completed',
      turnId,
      index: turn.idx,
      status: 'failed',
      stopReason: 'error',
      error,
    });
    const from = task.status as TaskStatus;
    const to: TaskStatus = 'failed';
    if (from === 'preparing' || from === 'running') {
      this.transition(taskId, from, to, turnId, {
        ended_at: new Date().toISOString(),
        last_error: JSON.stringify(error),
      });
    }
  }

  private cancelledBeforeRun(taskId: string, turnId: string): void {
    this.repo.updateTurn(turnId, {
      status: 'cancelled',
      stop_reason: 'cancelled',
      ended_at: new Date().toISOString(),
    });
    const turn = this.repo.turn(turnId)!;
    this.appendCore(taskId, turnId, {
      type: 'turn.completed',
      turnId,
      index: turn.idx,
      status: 'cancelled',
      stopReason: 'cancelled',
    });
    this.transition(taskId, 'preparing', 'cancelled', turnId, {
      ended_at: new Date().toISOString(),
    });
  }

  private lastMessage(taskId: string, turnId: string): string | null {
    const row = this.db.get<{ payload: string }>(
      `SELECT payload FROM events WHERE task_id = :t AND turn_id = :u AND type = 'message.completed'
       ORDER BY seq DESC LIMIT 1`,
      { t: taskId, u: turnId },
    );
    if (row) return (JSON.parse(row.payload) as { text: string }).text;
    const deltas = this.db.all<{ payload: string }>(
      `SELECT payload FROM events WHERE task_id = :t AND turn_id = :u AND type = 'message.delta' ORDER BY seq ASC`,
      { t: taskId, u: turnId },
    );
    if (!deltas.length) return null;
    return deltas.map((d) => (JSON.parse(d.payload) as { text: string }).text).join('');
  }

  private armIdle(taskId: string, idleMinutes: number): void {
    const a = this.sessions.get(taskId);
    if (!a) return;
    this.clearIdle(taskId);
    const ms = idleMinutes * 60_000;
    a.idleTimer = setTimeout(() => {
      this.sessions.delete(taskId);
      void a.session.dispose('idle');
    }, ms);
    a.idleTimer.unref();
  }

  private clearIdle(taskId: string): void {
    const a = this.sessions.get(taskId);
    if (a?.idleTimer) clearTimeout(a.idleTimer);
    if (a) a.idleTimer = null;
  }
}
