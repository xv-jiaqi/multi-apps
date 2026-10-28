import { api } from './api';
import { pendingKey } from './cache';
import type { TaskListFilter } from './types';

export function agentsQuery() {
  return {
    queryKey: ['agents'],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.listAgents(signal),
    refetchInterval: 10_000,
  };
}

export function reposQuery() {
  return {
    queryKey: ['repos'],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.listRepos(false, signal),
  };
}

export function repoRefsQuery(repoId: string) {
  return {
    queryKey: ['repos', repoId, 'refs'],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.listRepoRefs(repoId, signal),
    staleTime: 60_000,
  };
}

export function settingsQuery() {
  return {
    queryKey: ['settings'],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.getSettings(signal),
    staleTime: Number.POSITIVE_INFINITY,
  };
}

export function pendingApprovalsQuery() {
  return {
    queryKey: pendingKey(),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.listApprovals({ status: 'pending' }, signal),
    staleTime: Number.POSITIVE_INFINITY,
  };
}

export function taskListQuery(filter: TaskListFilter) {
  return {
    queryKey: ['tasks', 'list', filter],
    initialPageParam: null,
    queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) =>
      api.listTasks({ ...filter, limit: 50, cursor: pageParam ?? undefined }, signal),
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor,
    staleTime: Number.POSITIVE_INFINITY,
  };
}

export function taskDetailQuery(taskId: string) {
  return {
    queryKey: ['tasks', 'detail', taskId],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.getTask(taskId, signal),
    staleTime: Number.POSITIVE_INFINITY,
  };
}

export function taskDiffQuery(taskId: string, scope: 'task' | 'turn', turn: number | null) {
  return {
    queryKey: ['tasks', 'diff', taskId, scope, turn],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.getTaskDiff(taskId, { scope, turn: turn ?? undefined, live: false }, signal),
    staleTime: Number.POSITIVE_INFINITY,
  };
}

export function tokensQuery() {
  return {
    queryKey: ['tokens'],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.listTokens(signal),
  };
}

export function auditQuery(before: number | null) {
  return {
    queryKey: ['audit', before],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.listAudit({ before: before ?? undefined, limit: 100 }, signal),
  };
}
