import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ProcessSupervisor } from '../adapters/types';
import type { HubLogger } from '../common/logger';
import { GIT_GUARD, HUB_DB, HUB_LOGGER, PROCESS_SUPERVISOR } from '../common/tokens';
import { HubConfigService } from '../config/config.service';
import type { Db } from '../db/sqlite';
import { Lifecycle } from '../lifecycle';
import type { GitGuard } from '../workspace/git-guard';
import { AdapterRegistry } from './adapter-registry';
import { EventStore } from './event-store';
import { Scheduler } from './scheduler';
import { TaskRunner } from './task-runner';
import { TasksRepo } from '../db/repositories/tasks.repo';

/** architecture.md §10.2 / §10.3 中与任务核心相关的启动与停机步骤。 */
@Injectable()
export class HubRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(HUB_DB) private readonly db: Db,
    @Inject(HUB_LOGGER) private readonly logger: HubLogger,
    @Inject(PROCESS_SUPERVISOR) private readonly supervisor: ProcessSupervisor,
    @Inject(GIT_GUARD) private readonly guard: GitGuard,
    private readonly config: HubConfigService,
    private readonly lifecycle: Lifecycle,
    private readonly registry: AdapterRegistry,
    private readonly scheduler: Scheduler,
    private readonly runner: TaskRunner,
    private readonly events: EventStore,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const loginPath = await this.supervisor.loginPath();
    this.guard.ensure({ blockedPushHosts: this.config.get().security.blockedPushHosts, loginPath });
    const reaped = await this.supervisor.cleanupOrphans();
    if (reaped > 0) this.logger.info('清理了上次残留的 Agent 进程组', { count: reaped });
    this.recoverInterrupted();
    this.lifecycle.addShutdownHook(async () => {
      this.scheduler.stop();
      await this.runner.shutdown();
      await this.registry.shutdown();
      await this.supervisor.terminateAll();
      this.events.flushAll();
    });
    void this.registry
      .probeAll()
      .catch((e: unknown) => this.logger.warn('探测 Agent 失败', { error: String(e) }));
    this.scheduler.tick();
  }

  /** app.close() 时也走一遍停机（幂等），测试与 main 共用。 */
  async onApplicationShutdown(): Promise<void> {
    await this.lifecycle.shutdown();
  }

  /** §9.3：上次侧车退出时还在 preparing / running 的任务记为 interrupted，未决审批记 expired。 */
  private recoverInterrupted(): void {
    const repo = new TasksRepo(this.db);
    const now = new Date().toISOString();
    const stuck = repo.list({ statuses: ['preparing', 'running'], archived: false, limit: 10_000 });
    for (const task of stuck) {
      const turn = repo.latestTurn(task.id);
      this.db.tx(() => {
        if (turn && (turn.status === 'running' || turn.status === 'pending')) {
          repo.updateTurn(turn.id, { status: 'interrupted', stop_reason: 'error', ended_at: now });
        }
        this.db.run(
          `UPDATE approvals SET status = 'expired', decided_by = 'system', resolved_at = :ts
           WHERE task_id = :t AND status = 'pending'`,
          { ts: now, t: task.id },
        );
        repo.updateTask(task.id, { pending_approvals: 0 });
        const env = this.events.persistInTx(task.id, turn?.id ?? null, {
          type: 'task.status',
          from: task.status as 'preparing' | 'running',
          to: 'interrupted',
          reason: '侧车重启',
        });
        repo.updateTask(task.id, { status: 'interrupted', ended_at: now });
        return env;
      });
    }
    if (stuck.length)
      this.logger.warn('上次退出时未结束的任务已记为 interrupted', { count: stuck.length });
  }
}
