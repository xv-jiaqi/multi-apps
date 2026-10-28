import type { FollowUpValues } from '../../lib/task-form';

const drafts = new Map<string, FollowUpValues>();

export function readFollowUp(taskId: string): FollowUpValues | null {
  return drafts.get(taskId) ?? null;
}

export function writeFollowUp(taskId: string, values: FollowUpValues): void {
  drafts.set(taskId, values);
}
