import { type AgentDto } from '@agent-hub/contract';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@repo/ui-web';
import { Link } from 'react-router';
import { agentsQuery, pendingApprovalsQuery } from '../api/queries';
import { focusRing, healthText, healthTone, type HealthTone } from '../lib/format';
import { paths } from '../app/paths';
import { ServiceState } from './service-state';

const TONE_CLASS: Record<HealthTone, string> = {
  ok: 'bg-green-600',
  warn: 'bg-amber-500',
  bad: 'bg-red-600',
  muted: 'bg-neutral-400',
};

export function TopBar(): React.ReactElement {
  return (
    <header className="col-span-3 row-start-1 flex h-11 items-center gap-3 border-b border-neutral-200 bg-white px-3">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="shrink-0 text-sm font-semibold text-neutral-900">Agent Hub</h1>
        <AgentDots />
      </div>
      <div className="flex min-w-0 flex-1 justify-center">
        <ServiceState />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <PendingLink />
        <Link to={paths.newTask()} className={navButton}>
          新建任务
        </Link>
        <Link to={paths.settings()} className={navButton}>
          设置
        </Link>
      </div>
    </header>
  );
}

const navButton = `inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 ${focusRing}`;

function AgentDots(): React.ReactElement | null {
  const agents = useQuery(agentsQuery());
  if (agents.isError) {
    return (
      <button
        type="button"
        className={`h-8 rounded-md px-2 text-sm text-red-700 ${focusRing}`}
        onClick={() => void agents.refetch()}
      >
        Agent 状态加载失败，重试
      </button>
    );
  }
  if (agents.isLoading || !agents.data)
    return <span className="text-sm text-neutral-600">正在读取 Agent…</span>;
  const enabled = agents.data.items.filter((agent) => agent.enabled);
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      {enabled.map((agent) => (
        <AgentDot key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

function AgentDot(props: { agent: AgentDto }): React.ReactElement {
  const tone = healthTone(props.agent.health.status);
  const title = `${props.agent.displayName}：${healthText(props.agent.health)}`;
  return (
    <Link
      to={paths.settings('agents')}
      title={title}
      className={`inline-flex h-8 max-w-40 items-center gap-1 rounded-md px-2 text-sm text-neutral-800 hover:bg-neutral-100 ${focusRing}`}
    >
      <span className={cn('size-2 shrink-0 rounded-full', TONE_CLASS[tone])} aria-hidden="true" />
      <span className="truncate">{props.agent.displayName}</span>
      {props.agent.runningTasks > 0 ? (
        <span className="text-neutral-600">{props.agent.runningTasks}</span>
      ) : null}
    </Link>
  );
}

function PendingLink(): React.ReactElement | null {
  const pending = useQuery(pendingApprovalsQuery());
  if (pending.isError) {
    return (
      <button
        type="button"
        className={`h-8 rounded-md px-2 text-sm text-red-700 ${focusRing}`}
        onClick={() => void pending.refetch()}
      >
        待审批加载失败，重试
      </button>
    );
  }
  if (pending.isLoading || !pending.data) return null;
  const items = [...pending.data.items].sort((left, right) =>
    left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0,
  );
  const earliest = items[0];
  if (!earliest) return null;
  return (
    <Link to={paths.task(earliest.taskId, 'approvals')} className={navButton}>
      待审批 {items.length}
    </Link>
  );
}
