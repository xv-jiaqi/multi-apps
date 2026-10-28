import { taskSourceLabel, type AgentDto, type TaskDto } from '@agent-hub/contract';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { cn } from '@repo/ui-web';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { Link, useMatch } from 'react-router';
import { agentsQuery, taskListQuery } from '../../api/queries';
import { errorMessage } from '../../api/client';
import { paths } from '../../app/paths';
import { TaskStatusBadge } from '../../components/task-status';
import { countLabel, focusRing, formatTime } from '../../lib/format';
import {
  isFilterActive,
  toTaskListFilter,
  type ListFilterState,
  type StatusFilter,
} from '../../lib/list-filter';
import { listFilterStore } from './filter-state';

const ALL = '__all__';

export function TaskList(): ReactElement {
  const filter = useSyncExternalStore(
    listFilterStore.subscribe,
    listFilterStore.get,
    listFilterStore.get,
  );
  const [debouncedQ, setDebouncedQ] = useState(filter.q);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filter.q), 300);
    return () => clearTimeout(timer);
  }, [filter.q]);
  const queryState: ListFilterState = { ...filter, q: debouncedQ };
  const tasks = useInfiniteQuery(taskListQuery(toTaskListFilter(queryState)));
  const agents = useQuery(agentsQuery());
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (!tasks.hasNextPage || tasks.isFetchingNextPage) return;
      void tasks.fetchNextPage();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [tasks.hasNextPage, tasks.isFetchingNextPage, tasks.fetchNextPage]);

  const names = new Map((agents.data?.items ?? []).map((agent) => [agent.id, agent.displayName]));

  return (
    <section
      aria-label="任务列表"
      className="row-start-2 flex min-h-0 min-w-0 flex-col border-r border-neutral-200 bg-white"
    >
      <FilterBar filter={filter} agents={agents.data?.items ?? []} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ListBody
          error={tasks.isError ? errorMessage(tasks.error) : null}
          loading={tasks.isLoading}
          items={tasks.data?.pages.flatMap((page) => page.items) ?? []}
          active={isFilterActive(queryState)}
          names={names}
          onRetry={() => void tasks.refetch()}
        />
        <div ref={sentinel} className="h-8" />
      </div>
    </section>
  );
}

function ListBody(props: {
  error: string | null;
  loading: boolean;
  items: TaskDto[];
  active: boolean;
  names: Map<string, string>;
  onRetry: () => void;
}): ReactElement {
  if (props.error) {
    return (
      <div className="space-y-2 p-4" role="alert">
        <p className="select-text text-sm text-red-700">{props.error}</p>
        <button
          type="button"
          className={`h-8 rounded-md border border-neutral-300 px-3 text-sm ${focusRing}`}
          onClick={props.onRetry}
        >
          重试
        </button>
      </div>
    );
  }
  if (props.loading) return <p className="p-4 text-sm text-neutral-700">正在加载任务…</p>;
  if (props.items.length === 0) {
    if (props.active) {
      return (
        <div className="space-y-2 p-4 text-sm text-neutral-700">
          <p>没有符合筛选的任务</p>
          <button
            type="button"
            className={`h-8 rounded-md border border-neutral-300 px-3 ${focusRing}`}
            onClick={() => listFilterStore.clear()}
          >
            清除筛选
          </button>
        </div>
      );
    }
    return <p className="p-4 text-sm text-neutral-700">还没有任务</p>;
  }
  return (
    <ul>
      {props.items.map((task) => (
        <li key={task.id}>
          <TaskRow task={task} agentName={props.names.get(task.agentId) ?? task.agentId} />
        </li>
      ))}
    </ul>
  );
}

function TaskRow(props: { task: TaskDto; agentName: string }): ReactElement {
  const match = useMatch('/tasks/:taskId');
  const current = match?.params.taskId === props.task.id;
  const pending = countLabel(props.task.pendingApprovals, '待批');
  return (
    <Link
      to={paths.task(props.task.id)}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'block border-b border-neutral-200 px-3 py-2 text-neutral-900 hover:bg-neutral-50',
        focusRing,
        current && 'bg-neutral-100',
      )}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <TaskStatusBadge status={props.task.status} />
        <span>{taskSourceLabel(props.task.source)}</span>
        <span>{props.agentName}</span>
        <span className="text-neutral-600">{formatTime(props.task.createdAt)}</span>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{props.task.title}</span>
        {pending ? <span className="text-amber-800">{pending}</span> : null}
        {props.task.adapterKind === 'web' && props.task.status === 'running' ? (
          <span className="text-brand-700">待你操作</span>
        ) : null}
        {props.task.readOnlyViolation ? <span className="text-red-700">只读越界</span> : null}
      </p>
      <p className="mt-1 text-sm text-neutral-600">
        {props.task.repoId} · #{props.task.shortId} · 第 {props.task.turnCount} 轮
      </p>
    </Link>
  );
}

function FilterBar(props: { filter: ListFilterState; agents: readonly AgentDto[] }): ReactElement {
  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-2"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="text-sm text-neutral-700">
        状态
        <select
          className={`ml-1 h-8 rounded-md border border-neutral-300 bg-white px-2 text-sm ${focusRing}`}
          value={props.filter.status}
          onChange={(event) => {
            const value = event.target.value;
            if (isStatus(value)) listFilterStore.set({ status: value });
          }}
        >
          <option value="all">全部</option>
          <option value="active">进行中</option>
          <option value="ended">已结束</option>
          <option value="archived">已归档</option>
        </select>
      </label>
      <label className="text-sm text-neutral-700">
        Agent
        <select
          className={`ml-1 h-8 max-w-36 rounded-md border border-neutral-300 bg-white px-2 text-sm ${focusRing}`}
          value={props.filter.agentId || ALL}
          onChange={(event) =>
            listFilterStore.set({ agentId: event.target.value === ALL ? '' : event.target.value })
          }
        >
          <option value={ALL}>全部</option>
          {props.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm text-neutral-700">
        来源
        <select
          className={`ml-1 h-8 rounded-md border border-neutral-300 bg-white px-2 text-sm ${focusRing}`}
          value={props.filter.source || ALL}
          onChange={(event) => {
            const value = event.target.value;
            listFilterStore.set({ source: value === 'ui' || value === 'bridge' ? value : '' });
          }}
        >
          <option value={ALL}>全部</option>
          <option value="ui">界面</option>
          <option value="bridge">本地郎</option>
        </select>
      </label>
      <label className="text-sm text-neutral-700">
        标题
        <input
          type="search"
          name="q"
          autoComplete="off"
          maxLength={100}
          value={props.filter.q}
          placeholder="搜索标题"
          className={`ml-1 h-8 w-36 rounded-md border border-neutral-300 px-2 text-sm ${focusRing}`}
          onChange={(event) => listFilterStore.set({ q: event.target.value.slice(0, 100) })}
        />
      </label>
    </form>
  );
}

function isStatus(value: string): value is StatusFilter {
  return value === 'all' || value === 'active' || value === 'ended' || value === 'archived';
}
