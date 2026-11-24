import type { TaskStatus } from '@agent-hub/contract';
import { ApiError } from '../api/api-error';

/** architecture.md §3.1 的迁移表。 */
export const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ['preparing', 'cancelled'],
  preparing: ['running', 'failed', 'cancelled', 'interrupted'],
  running: ['completed', 'failed', 'cancelled', 'interrupted'],
  completed: ['queued'],
  failed: ['queued'],
  cancelled: ['queued'],
  interrupted: ['queued'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new ApiError('ILLEGAL_TRANSITION', `任务不能从 ${from} 变为 ${to}`);
  }
}
