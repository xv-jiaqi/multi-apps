import { TERMINAL_TASK_STATUSES, type TaskSource } from '@agent-hub/contract';
import type { TaskListFilter } from '../api/types';

export type StatusFilter = 'all' | 'active' | 'ended' | 'archived';

export interface ListFilterState {
  status: StatusFilter;
  agentId: string;
  source: '' | TaskSource;
  q: string;
}

export const ACTIVE_STATUSES = 'queued,preparing,running';
export const ENDED_STATUSES = TERMINAL_TASK_STATUSES.join(',');
const QUERY_MAX = 100;

export function toTaskListFilter(state: ListFilterState): TaskListFilter {
  const filter: TaskListFilter = { archived: state.status === 'archived' };
  if (state.status === 'active') filter.status = ACTIVE_STATUSES;
  if (state.status === 'ended') filter.status = ENDED_STATUSES;
  if (state.agentId) filter.agentId = state.agentId;
  if (state.source) filter.source = state.source;
  const q = state.q.trim().slice(0, QUERY_MAX);
  if (q) filter.q = q;
  return filter;
}

export function isFilterActive(state: ListFilterState): boolean {
  return (
    state.status !== 'all' || state.agentId !== '' || state.source !== '' || state.q.trim() !== ''
  );
}
