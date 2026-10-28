import type {
  ApprovalDto,
  HubEventEnvelope,
  ListTasksResponse,
  TaskDetailDto,
  TaskDto,
} from '@agent-hub/contract';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { isRecord } from '../lib/guard';
import type { TaskListFilter } from './types';

interface TaskPages {
  pages: ListTasksResponse[];
  pageParams: unknown[];
}

interface ApprovalPage {
  items: ApprovalDto[];
}

export function matchesFilter(task: TaskDto, filter: TaskListFilter): boolean {
  const archived = task.archivedAt !== null;
  if (archived !== filter.archived) return false;
  if (filter.status) {
    const statuses = filter.status
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (!statuses.some((status) => status === task.status)) return false;
  }
  if (filter.agentId && task.agentId !== filter.agentId) return false;
  if (filter.repoId && task.repoId !== filter.repoId) return false;
  if (filter.source && task.source !== filter.source) return false;
  if (filter.externalRef && task.externalRef !== filter.externalRef) return false;
  if (filter.q && !task.title.toLowerCase().includes(filter.q.toLowerCase())) return false;
  return true;
}

/** 比详情旧的推送整个忽略。列表里有则替换，不再符合过滤条件则移出；没有但符合条件时，比第一条新就插到最前，否则让该列表失效。 */
export function applyTask(qc: QueryClient, task: TaskDto): void {
  const detail = qc.getQueryData<TaskDetailDto>(detailKey(task.id));
  if (detail && isBefore(task.updatedAt, detail.updatedAt)) return;
  if (detail) qc.setQueryData<TaskDetailDto>(detailKey(task.id), { ...detail, ...task });

  for (const [key, data] of qc.getQueriesData<TaskPages>({ queryKey: ['tasks', 'list'] })) {
    const filter = readFilter(key);
    if (!filter || !data) continue;
    const located = locate(data, task.id);
    if (located) {
      const current = located.item;
      if (isBefore(task.updatedAt, current.updatedAt)) continue;
      const pages = data.pages.map((page, pageIndex) => {
        if (pageIndex !== located.pageIndex) return page;
        const items = page.items.flatMap((item) => {
          if (item.id !== task.id) return [item];
          return matchesFilter(task, filter) ? [task] : [];
        });
        return { ...page, items };
      });
      qc.setQueryData<TaskPages>(key, { ...data, pages });
      continue;
    }
    if (!matchesFilter(task, filter)) continue;
    const first = data.pages[0]?.items[0];
    if (!first || isBefore(first.createdAt, task.createdAt)) {
      insertFront(qc, key, data, task);
    } else {
      void qc.invalidateQueries({ queryKey: key });
    }
  }
}

export function applyApproval(qc: QueryClient, approval: ApprovalDto): void {
  qc.setQueryData<ApprovalPage>(pendingKey(), (current) => {
    const items = (current?.items ?? []).filter((item) => item.id !== approval.id);
    if (approval.status !== 'pending') return { items };
    items.push(approval);
    items.sort((left, right) => compareTime(left.createdAt, right.createdAt));
    return { items };
  });
  const detail = qc.getQueryData<TaskDetailDto>(detailKey(approval.taskId));
  if (!detail) return;
  const exists = detail.approvals.some((item) => item.id === approval.id);
  const approvals = exists
    ? detail.approvals.map((item) => (item.id === approval.id ? approval : item))
    : [...detail.approvals, approval].sort((left, right) =>
        compareTime(left.createdAt, right.createdAt),
      );
  qc.setQueryData<TaskDetailDto>(detailKey(approval.taskId), { ...detail, approvals });
}

export function applyTaskEvent(qc: QueryClient, envelope: HubEventEnvelope): void {
  if (envelope.event.type === 'turn.started' || envelope.event.type === 'turn.completed') {
    void qc.invalidateQueries({ queryKey: detailKey(envelope.taskId) });
    return;
  }
  if (envelope.event.type === 'diff.updated') {
    void qc.invalidateQueries({ queryKey: ['tasks', 'diff', envelope.taskId] });
  }
}

export function removeTask(qc: QueryClient, id: string): void {
  qc.removeQueries({ queryKey: detailKey(id) });
  qc.removeQueries({ queryKey: ['tasks', 'diff', id] });
  for (const [key, data] of qc.getQueriesData<TaskPages>({ queryKey: ['tasks', 'list'] })) {
    if (!data) continue;
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.id !== id),
    }));
    qc.setQueryData<TaskPages>(key, { ...data, pages });
  }
}

export function resyncAll(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['tasks'] });
  void qc.invalidateQueries({ queryKey: pendingKey() });
}

export function detailKey(id: string): readonly [string, string, string] {
  return ['tasks', 'detail', id];
}

export function pendingKey(): readonly [string, string] {
  return ['approvals', 'pending'];
}

function insertFront(qc: QueryClient, key: QueryKey, data: TaskPages, task: TaskDto): void {
  const first = data.pages[0];
  if (!first) {
    qc.setQueryData<TaskPages>(key, {
      ...data,
      pages: [{ items: [task], nextCursor: null }],
    });
    return;
  }
  const pages = data.pages.slice();
  pages[0] = { ...first, items: [task, ...first.items] };
  qc.setQueryData<TaskPages>(key, { ...data, pages });
}

function locate(data: TaskPages, id: string): { pageIndex: number; item: TaskDto } | null {
  for (let pageIndex = 0; pageIndex < data.pages.length; pageIndex += 1) {
    const page = data.pages[pageIndex];
    const item = page?.items.find((candidate) => candidate.id === id);
    if (item) return { pageIndex, item };
  }
  return null;
}

function readFilter(key: QueryKey): TaskListFilter | null {
  if (key[0] !== 'tasks' || key[1] !== 'list') return null;
  return isTaskListFilter(key[2]) ? key[2] : null;
}

function isTaskListFilter(value: unknown): value is TaskListFilter {
  if (!isRecord(value) || typeof value.archived !== 'boolean') return false;
  if (value.status !== undefined && typeof value.status !== 'string') return false;
  if (value.agentId !== undefined && typeof value.agentId !== 'string') return false;
  if (value.repoId !== undefined && typeof value.repoId !== 'string') return false;
  if (value.source !== undefined && value.source !== 'ui' && value.source !== 'bridge')
    return false;
  if (value.externalRef !== undefined && typeof value.externalRef !== 'string') return false;
  if (value.q !== undefined && typeof value.q !== 'string') return false;
  return true;
}

function isBefore(left: string, right: string): boolean {
  return compareTime(left, right) < 0;
}

function compareTime(left: string, right: string): number {
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
