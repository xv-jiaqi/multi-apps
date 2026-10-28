import type { AgentDto, ItemsResponse, TaskDto } from '@agent-hub/contract';
import type { QueryClient } from '@tanstack/react-query';
import { notificationFor } from '../desktop/notify-rules';
import { agentsQuery } from './queries';
import type { TaskHandlers } from './socket';

/** 顶栏同一份 `['agents']` 查询。没有这条 Agent，或没有显示名时，退回 agentId。 */
export function agentDisplayNameFromQuery(qc: QueryClient, agentId: string): string {
  const data = qc.getQueryData<ItemsResponse<AgentDto>>(agentsQuery().queryKey);
  const name = data?.items.find((agent) => agent.id === agentId)?.displayName;
  if (!name) return agentId;
  return name;
}

export class AttentionWatcher {
  private readonly subs = new Map<string, () => void>();
  private readonly tasks = new Map<string, TaskDto>();
  /** 每个任务已经处理到的 seq。重连时 afterSeq 从这里接着收，避免把通知再放一遍。 */
  private readonly seqs = new Map<string, number>();

  constructor(
    private readonly deps: {
      subscribeTask: (taskId: string, handlers: TaskHandlers) => () => void;
      notify(text: { title: string; body: string }): void;
      isBackground(): boolean;
      agentDisplayName(agentId: string): string;
    },
  ) {}

  onTask(task: TaskDto): void {
    this.tasks.set(task.id, task);
    if (!this.seqs.has(task.id)) this.seqs.set(task.id, task.lastEventSeq);
    const active = task.status === 'preparing' || task.status === 'running';
    if (!active) {
      this.release(task.id);
      return;
    }
    if (this.subs.has(task.id)) return;
    const unsubscribe = this.deps.subscribeTask(task.id, {
      afterSeq: () => this.seqs.get(task.id) ?? task.lastEventSeq,
      onEvent: (envelope) => {
        const seen = this.seqs.get(task.id) ?? task.lastEventSeq;
        if (envelope.seq <= seen) return;
        this.seqs.set(task.id, envelope.seq);
        const current = this.tasks.get(task.id) ?? task;
        const text = notificationFor(
          envelope,
          current,
          this.deps.agentDisplayName(current.agentId),
          Date.now(),
        );
        if (!text || !this.deps.isBackground()) return;
        this.deps.notify(text);
      },
      onGone: () => this.release(task.id),
    });
    this.subs.set(task.id, unsubscribe);
  }

  stop(): void {
    for (const taskId of [...this.subs.keys()]) this.release(taskId);
  }

  private release(taskId: string): void {
    this.seqs.delete(taskId);
    const unsubscribe = this.subs.get(taskId);
    if (!unsubscribe) return;
    this.subs.delete(taskId);
    unsubscribe();
  }
}
