import { Inject, Injectable } from '@nestjs/common';
import type { ApprovalDecision, ApprovalDto, DecidedBy } from '@agent-hub/contract';
import type { ApprovalOutcome, ApprovalRequestInput } from '../adapters/types';
import { ApiError } from '../api/api-error';
import { redact } from '../common/redact';
import { HUB_DB } from '../common/tokens';
import { HubConfigService } from '../config/config.service';
import { approvalToDto, taskToDto, TasksRepo } from '../db/repositories/tasks.repo';
import type { Db } from '../db/sqlite';
import { EventBus } from './event-bus';
import { EventStore } from './event-store';
import { newId } from './ids';

interface Waiter {
  taskId: string;
  turnId: string;
  resolve: (o: ApprovalOutcome) => void;
  timer: NodeJS.Timeout;
  fallback: ApprovalDecision;
}

/** adapter-interface.md §5：审批落库、广播、等待、超时、撤回。不自动批准。 */
@Injectable()
export class ApprovalService {
  private readonly repo: TasksRepo;
  private readonly waiters = new Map<string, Waiter>();

  constructor(
    @Inject(HUB_DB) private readonly db: Db,
    private readonly events: EventStore,
    private readonly bus: EventBus,
    private readonly config: HubConfigService,
  ) {
    this.repo = new TasksRepo(db);
  }

  request(
    taskId: string,
    turnId: string,
    input: ApprovalRequestInput,
    signal: AbortSignal,
  ): Promise<ApprovalOutcome> {
    const id = newId('apr_');
    const now = new Date();
    const timeoutMs = this.config.get().security.approvalTimeoutMinutes * 60_000;
    const expires = new Date(now.getTime() + timeoutMs);
    const fallback: ApprovalDecision = input.options.includes('reject')
      ? 'reject'
      : input.options[0]!;
    const req = {
      command: input.command,
      cwd: input.cwd,
      paths: input.paths,
      reason: input.reason,
      detail:
        input.detail === undefined ? undefined : JSON.parse(redact(JSON.stringify(input.detail))),
    };
    this.events.flush(taskId);
    const env = this.db.tx(() => {
      this.repo.insertApproval({
        id,
        task_id: taskId,
        turn_id: turnId,
        kind: input.kind,
        title: input.title,
        request: JSON.stringify(req),
        options: JSON.stringify(input.options),
        status: 'pending',
        decision: null,
        decided_by: null,
        decided_by_token_id: null,
        note: null,
        created_at: now.toISOString(),
        expires_at: expires.toISOString(),
        resolved_at: null,
      });
      this.repo.adjustPendingApprovals(taskId, 1);
      return this.events.persistInTx(taskId, turnId, {
        type: 'approval.requested',
        approval: approvalToDto(this.repo.approval(id)!),
      });
    });
    this.events.publish(env);
    this.broadcast(id, taskId);

    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(
        () => this.settle(id, 'expired', fallback, 'system', null, null),
        timeoutMs,
      );
      this.waiters.set(id, { taskId, turnId, resolve, timer, fallback });
      const onAbort = () => this.withdraw(id);
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  decide(
    id: string,
    decision: ApprovalDecision,
    by: DecidedBy,
    tokenId: string | null,
    note: string | null,
  ): ApprovalDto {
    const row = this.repo.approval(id);
    if (!row) throw new ApiError('APPROVAL_NOT_FOUND', '审批不存在');
    if (row.status !== 'pending' || !this.waiters.has(id)) {
      throw new ApiError('APPROVAL_NOT_PENDING', '审批已处理');
    }
    const options = JSON.parse(row.options) as ApprovalDecision[];
    if (!options.includes(decision)) {
      throw new ApiError('VALIDATION_FAILED', `这个审批不支持决定 ${decision}`);
    }
    this.settle(
      id,
      decision === 'reject' || decision === 'cancel_turn' ? 'rejected' : 'approved',
      decision,
      by,
      tokenId,
      note,
    );
    return approvalToDto(this.repo.approval(id)!);
  }

  /** 轮结束兜底。 */
  withdrawAll(turnId: string): void {
    for (const [id, w] of this.waiters) if (w.turnId === turnId) this.withdraw(id);
  }

  /** 停机：按兜底决定回复。 */
  expireAll(): void {
    for (const [id, w] of [...this.waiters])
      this.settle(id, 'expired', w.fallback, 'system', null, null);
  }

  private withdraw(id: string): void {
    const w = this.waiters.get(id);
    if (!w) return;
    this.finishRow(id, w, 'withdrawn', null, 'system', null, null);
    w.resolve({ withdrawn: true });
  }

  private settle(
    id: string,
    status: 'approved' | 'rejected' | 'expired',
    decision: ApprovalDecision,
    by: DecidedBy,
    tokenId: string | null,
    note: string | null,
  ): void {
    const w = this.waiters.get(id);
    if (!w) return;
    this.finishRow(id, w, status, decision, by, tokenId, note);
    w.resolve({ decision });
  }

  private finishRow(
    id: string,
    w: Waiter,
    status: 'approved' | 'rejected' | 'expired' | 'withdrawn',
    decision: ApprovalDecision | null,
    by: DecidedBy,
    tokenId: string | null,
    note: string | null,
  ): void {
    clearTimeout(w.timer);
    this.waiters.delete(id);
    this.events.flush(w.taskId);
    const env = this.db.tx(() => {
      this.repo.updateApproval(id, {
        status,
        decision,
        decided_by: by,
        decided_by_token_id: tokenId,
        note,
        resolved_at: new Date().toISOString(),
      });
      this.repo.adjustPendingApprovals(w.taskId, -1);
      return this.events.persistInTx(w.taskId, w.turnId, {
        type: 'approval.resolved',
        approvalId: id,
        status,
        decision,
        decidedBy: by,
      });
    });
    this.events.publish(env);
    this.broadcast(id, w.taskId);
  }

  private broadcast(approvalId: string, taskId: string): void {
    const row = this.repo.approval(approvalId);
    if (row) this.bus.publishApproval(approvalToDto(row));
    const task = this.repo.task(taskId);
    if (task) this.bus.publishTask(taskToDto(task));
  }
}
