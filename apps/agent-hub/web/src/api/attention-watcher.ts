import type { TaskDto } from '@agent-hub/contract';
import { notificationFor } from '../desktop/notify-rules';
import type { TaskHandlers } from './socket';

export class AttentionWatcher {
  private readonly subs = new Map<string, () => void>();
  private readonly tasks = new Map<string, TaskDto>();

  constructor(
    private readonly deps: {
      subscribeTask: (taskId: string, handlers: TaskHandlers) => () => void;
      notify(text: { title: string; body: string }): void;
      isBackground(): boolean;
    },
  ) {}

  onTask(task: TaskDto): void {
    this.tasks.set(task.id, task);
    const active = task.status === 'preparing' || task.status === 'running';
    if (!active) {
      this.release(task.id);
      return;
    }
    if (this.subs.has(task.id)) return;
    const unsubscribe = this.deps.subscribeTask(task.id, {
      afterSeq: () => 0,
      onEvent: (envelope) => {
        const current = this.tasks.get(task.id) ?? task;
        const text = notificationFor(envelope, current, current.agentId, Date.now());
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
    const unsubscribe = this.subs.get(taskId);
    if (!unsubscribe) return;
    this.subs.delete(taskId);
    unsubscribe();
  }
}
