import { Inject, Injectable } from '@nestjs/common';
import { HUB_DB } from '../common/tokens';
import { HubConfigService } from '../config/config.service';
import { TasksRepo } from '../db/repositories/tasks.repo';
import type { Db } from '../db/sqlite';
import { TaskRunner } from './task-runner';

/** architecture.md §4：并发上限 + 同目录写互斥；只在事件发生时重算，不轮询。 */
@Injectable()
export class Scheduler {
  private readonly repo: TasksRepo;
  private stopped = false;

  constructor(
    @Inject(HUB_DB) db: Db,
    private readonly config: HubConfigService,
    private readonly runner: TaskRunner,
  ) {
    this.repo = new TasksRepo(db);
    this.runner.onSlotFreed = () => this.tick();
  }

  stop(): void {
    this.stopped = true;
  }

  tick(): void {
    if (this.stopped) return;
    const cfg = this.config.get();
    let active = this.repo.countByStatus(['preparing', 'running']);
    const perAgent = new Map<string, number>();
    const busyDirs = new Set(
      this.repo
        .list({ statuses: ['preparing', 'running'], archived: false, limit: 500 })
        .filter((t) => t.workspace_kind === 'in_place')
        .map((t) => `${t.repo_path}|${t.mode}`),
    );
    for (const task of this.repo.queued()) {
      if (active >= cfg.scheduler.maxConcurrentTasks) return;
      if (this.runner.isActive(task.id)) continue;
      const agent = cfg.agents.find((a) => a.id === task.agent_id);
      const limit = agent?.maxConcurrentTasks ?? 1;
      const used =
        perAgent.get(task.agent_id) ??
        this.repo.countByStatus(['preparing', 'running'], task.agent_id);
      if (agent && used >= limit) continue;
      if (task.workspace_kind === 'in_place') {
        const writeBusy = busyDirs.has(`${task.repo_path}|write`);
        const anyBusy = writeBusy || busyDirs.has(`${task.repo_path}|read_only`);
        if (writeBusy || (task.mode === 'write' && anyBusy)) continue;
        busyDirs.add(`${task.repo_path}|${task.mode}`);
      }
      const turn = this.repo.pendingTurn(task.id);
      if (!turn) continue;
      perAgent.set(task.agent_id, used + 1);
      active += 1;
      this.runner.start(task, turn);
    }
  }
}
