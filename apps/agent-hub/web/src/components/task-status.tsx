import { taskStatusLabel, type TaskStatus } from '@agent-hub/contract';
import { cn } from '@repo/ui-web';
import type { ReactElement } from 'react';

const TONE: Record<TaskStatus, string> = {
  queued: 'bg-neutral-400',
  preparing: 'bg-amber-500',
  running: 'bg-brand-600',
  completed: 'bg-green-600',
  failed: 'bg-red-600',
  cancelled: 'bg-neutral-500',
  interrupted: 'bg-amber-700',
};

export function TaskStatusBadge(props: { status: TaskStatus; className?: string }): ReactElement {
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-sm text-neutral-800', props.className)}
    >
      <span className={cn('size-2 rounded-full', TONE[props.status])} aria-hidden="true" />
      {taskStatusLabel(props.status)}
    </span>
  );
}
