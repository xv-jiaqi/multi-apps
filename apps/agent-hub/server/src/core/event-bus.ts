import { Injectable } from '@nestjs/common';
import type { ApprovalDto, HubEventEnvelope, TaskDto } from '@agent-hub/contract';
import { Subject } from 'rxjs';

@Injectable()
export class EventBus {
  readonly events$ = new Subject<HubEventEnvelope>();
  readonly task$ = new Subject<TaskDto>();
  readonly approval$ = new Subject<ApprovalDto>();

  publishEvent(env: HubEventEnvelope): void {
    this.events$.next(env);
  }

  publishTask(task: TaskDto): void {
    this.task$.next(task);
  }

  publishApproval(approval: ApprovalDto): void {
    this.approval$.next(approval);
  }

  subscribeTaskEvents(taskId: string, listener: (env: HubEventEnvelope) => void): () => void {
    const sub = this.events$.subscribe((env) => {
      if (env.taskId === taskId) listener(env);
    });
    return () => sub.unsubscribe();
  }

  subscribeAllEvents(listener: (env: HubEventEnvelope) => void): () => void {
    const sub = this.events$.subscribe(listener);
    return () => sub.unsubscribe();
  }
}
