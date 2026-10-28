import {
  isTerminalStatus,
  taskModeLabel,
  workspaceKindLabel,
  type AgentConfig,
  type TaskDetailDto,
} from '@agent-hub/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui-web';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { api } from '../../api/api';
import { ApiError, errorMessage } from '../../api/client';
import { detailKey, removeTask } from '../../api/cache';
import { agentsQuery, reposQuery, settingsQuery, taskDetailQuery } from '../../api/queries';
import { parseTaskTab, paths, type TaskTab } from '../../app/paths';
import { useTaskGone } from '../../app/hooks';
import { HubAlertDialog } from '../../components/hub-dialog';
import { TaskStatusBadge } from '../../components/task-status';
import { revealInFinder } from '../../desktop/external';
import { focusRing, modelLine } from '../../lib/format';
import { toast } from '../../lib/toast';
import type { AgentDefaults } from '../../lib/task-form';
import { ApplyDialog } from './apply-dialog';
import { ApprovalCard } from './approval-card';
import { Composer } from './composer';
import { DiffTab } from './diff-tab';
import { OutputTab } from './output-tab';
import { WebTaskPanel } from './web-task-panel';

export function TaskDetailPage(): ReactElement {
  const params = useParams();
  const taskId = params.taskId ?? '';
  const task = useQuery(taskDetailQuery(taskId));
  const gone = useTaskGone(taskId);
  if (
    gone ||
    (task.isError && task.error instanceof ApiError && task.error.code === 'TASK_NOT_FOUND')
  ) {
    return (
      <div className="space-y-2 p-4">
        <p>任务不存在或已删除</p>
        <Link to={paths.home()} className={`text-sm text-brand-700 underline ${focusRing}`}>
          返回列表
        </Link>
      </div>
    );
  }
  if (task.isError) {
    return (
      <div className="space-y-2 p-4" role="alert">
        <p className="select-text text-sm text-red-700">{errorMessage(task.error)}</p>
        <Button type="button" variant="outline" onClick={() => void task.refetch()}>
          重试
        </Button>
      </div>
    );
  }
  if (task.isLoading || !task.data)
    return <p className="p-4 text-sm text-neutral-700">正在加载任务…</p>;
  return <TaskDetailBody task={task.data} />;
}

function TaskDetailBody(props: { task: TaskDetailDto }): ReactElement {
  const [search, setSearch] = useSearchParams();
  const tab = parseTaskTab(search.get('tab'));
  const agents = useQuery(agentsQuery());
  const repos = useQuery(reposQuery());
  const settings = useQuery(settingsQuery());
  const agent = agents.data?.items.find((item) => item.id === props.task.agentId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [stopArmed, setStopArmed] = useState(false);
  const [confirm, setConfirm] = useState<null | 'force' | 'delete'>(null);
  const qc = useQueryClient();
  const terminal = isTerminalStatus(props.task.status);
  const pendingCount = props.task.approvals.filter((item) => item.status === 'pending').length;
  const diffCount = [...props.task.turns].reverse().find((turn) => turn.taskStats)
    ?.taskStats?.filesChanged;

  const cancel = useMutation({
    mutationFn: (force: boolean) => api.cancelTask(props.task.id, { force }),
    onSuccess: async () => {
      setStopArmed(true);
      await qc.invalidateQueries({ queryKey: detailKey(props.task.id) });
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      props.task.archivedAt ? api.unarchiveTask(props.task.id) : api.archiveTask(props.task.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: detailKey(props.task.id) });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteTask(props.task.id),
    onSuccess: () => {
      removeTask(qc, props.task.id);
    },
  });

  function setTab(next: TaskTab): void {
    const params = new URLSearchParams(search);
    if (next === 'output') params.delete('tab');
    else params.set('tab', next);
    setSearch(params);
  }

  const stopLabel =
    props.task.status === 'queued' ? '取消' : stopArmed && !terminal ? '强制停止' : '停止本轮';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-2 border-b border-neutral-200 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold text-neutral-900">{props.task.title}</h1>
          <TaskStatusBadge status={props.task.status} />
        </div>
        <p className="text-sm text-neutral-700">
          {agent?.displayName ?? props.task.agentId} · {taskModeLabel(props.task.mode)} ·{' '}
          {modelLine(props.task.model, props.task.reasoningEffort)} ·{' '}
          {workspaceKindLabel(props.task.workspace)} · {props.task.repoId}
          {props.task.branch ? ` · ${props.task.branch}` : ''} · #{props.task.shortId}
        </p>
        <div className="flex flex-wrap gap-2">
          {!terminal ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => {
                if (stopLabel === '强制停止') setConfirm('force');
                else cancel.mutate(false);
              }}
            >
              {stopLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.focus()}
          >
            追问
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setApplyOpen(true)}>
            应用
          </Button>
          {terminal ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={archive.isPending}
              onClick={() => archive.mutate()}
            >
              {props.task.archivedAt ? '取消归档' : '归档'}
            </Button>
          ) : null}
          {props.task.archivedAt ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => setConfirm('delete')}
            >
              删除
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const target = props.task.workspacePath ?? props.task.repoPath;
              void revealInFinder(target).catch((error: unknown) =>
                toast.error(errorMessage(error)),
              );
            }}
          >
            在 Finder 中显示
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const target = props.task.workspacePath ?? props.task.repoPath;
              void navigator.clipboard.writeText(target).then(
                () => toast.info('已复制路径'),
                (error: unknown) => toast.error(errorMessage(error)),
              );
            }}
          >
            复制路径
          </Button>
        </div>
      </header>
      {props.task.lastError ? (
        <p
          className="select-text border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {props.task.lastError.message}
        </p>
      ) : null}
      {props.task.readOnlyViolation ? (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          只读越界
        </p>
      ) : null}
      {props.task.worktreeRemovedAt ? (
        <p className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
          worktree 已清理
        </p>
      ) : null}
      {props.task.adapterKind === 'web' ? (
        <WebTaskPanel
          task={props.task}
          repos={repos.data?.items ?? []}
          config={settings.data?.config}
        />
      ) : null}
      <div className="flex gap-2 border-b border-neutral-200 px-3" role="tablist">
        <TabButton current={tab} id="output" onSelect={setTab}>
          输出
        </TabButton>
        <TabButton current={tab} id="diff" onSelect={setTab}>
          Diff{diffCount !== undefined ? ` ${diffCount}` : ''}
        </TabButton>
        <TabButton current={tab} id="approvals" onSelect={setTab}>
          审批 {pendingCount}
        </TabButton>
        <TabButton current={tab} id="info" onSelect={setTab}>
          详情
        </TabButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
        {tab === 'output' ? <OutputTab task={props.task} /> : null}
        {tab === 'diff' ? <DiffTab task={props.task} /> : null}
        {tab === 'approvals' ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {props.task.approvals.length === 0 ? (
              <p className="text-sm text-neutral-600">没有审批</p>
            ) : null}
            {props.task.approvals.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} taskId={props.task.id} />
            ))}
          </div>
        ) : null}
        {tab === 'info' ? <InfoTab task={props.task} /> : null}
      </div>
      <Composer
        task={props.task}
        agent={agent}
        defaults={defaultsFor(settings.data?.config.agents, props.task.agentId)}
        inputRef={inputRef}
      />
      <ApplyDialog task={props.task} open={applyOpen} onOpenChange={setApplyOpen} />
      <HubAlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm === 'delete' ? '删除任务' : '强制停止'}
        description={confirm === 'delete' ? '删除后不能恢复。' : '再试一次强制结束本轮。'}
        confirmText={confirm === 'delete' ? '删除' : '强制停止'}
        destructive={confirm === 'delete'}
        onConfirm={() => {
          if (confirm === 'delete') remove.mutate();
          else cancel.mutate(true);
        }}
      />
    </div>
  );
}

function TabButton(props: {
  current: TaskTab;
  id: TaskTab;
  onSelect: (tab: TaskTab) => void;
  children: ReactNode;
}): ReactElement {
  const selected = props.current === props.id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`h-8 border-b-2 px-2 text-sm ${selected ? 'border-brand-700 text-neutral-900' : 'border-transparent text-neutral-600'} ${focusRing}`}
      onClick={() => props.onSelect(props.id)}
    >
      {props.children}
    </button>
  );
}

function InfoTab(props: { task: TaskDetailDto }): ReactElement {
  const rows: Array<[string, string]> = [
    ['状态', props.task.status],
    ['模式', taskModeLabel(props.task.mode)],
    ['工作区', workspaceKindLabel(props.task.workspace)],
    ['路径', props.task.workspacePath ?? props.task.repoPath],
    ['基线', props.task.baseRef ?? ''],
    ['创建', props.task.createdAt],
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th className="border border-neutral-200 px-2 py-1 text-left font-medium text-neutral-700">
                {label}
              </th>
              <td className="select-text border border-neutral-200 px-2 py-1 text-neutral-900">
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr>
            <th className="border border-neutral-200 px-2 py-1 text-left">轮</th>
            <th className="border border-neutral-200 px-2 py-1 text-left">状态</th>
            <th className="border border-neutral-200 px-2 py-1 text-left">提示词</th>
          </tr>
        </thead>
        <tbody>
          {props.task.turns.map((turn) => (
            <tr key={turn.id}>
              <td className="border border-neutral-200 px-2 py-1">{turn.index}</td>
              <td className="border border-neutral-200 px-2 py-1">{turn.status}</td>
              <td className="select-text border border-neutral-200 px-2 py-1">{turn.prompt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function defaultsFor(agents: readonly AgentConfig[] | undefined, agentId: string): AgentDefaults {
  const agent = agents?.find((item) => item.id === agentId);
  if (!agent || agent.kind === 'web') return { defaultModel: null, defaultReasoningEffort: null };
  return { defaultModel: agent.defaultModel, defaultReasoningEffort: agent.defaultReasoningEffort };
}
