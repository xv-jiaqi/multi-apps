import {
  taskStatusLabel,
  type HubConfig,
  type RepoDto,
  type TaskDetailDto,
} from '@agent-hub/contract';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui-web';
import { useState, type ReactElement } from 'react';
import { api } from '../../api/api';
import { errorMessage } from '../../api/client';
import { detailKey } from '../../api/cache';
import { openExternal } from '../../desktop/external';
import { useTaskTimeline } from '../../app/hooks';
import { focusRing } from '../../lib/format';
import { toast } from '../../lib/toast';

export function WebTaskPanel(props: {
  task: TaskDetailDto;
  repos: readonly RepoDto[];
  config: HubConfig | undefined;
}): ReactElement {
  const snapshot = useTaskTimeline(props.task.id);
  const current = props.task.turns.at(-1);
  const remote = [...snapshot.items]
    .reverse()
    .find((item) => item.kind === 'remote' && item.turnId === current?.id);
  const handoff = snapshot.items.find(
    (item) =>
      item.kind === 'tool' && item.turnId === current?.id && /^t\d+-handoff$/.test(item.itemId),
  );
  const repo = props.repos.find((item) => item.id === props.task.repoId);
  const remoteName =
    props.config?.repos.find((item) => item.id === props.task.repoId)?.internalRemote ?? 'internal';
  const pushUrl = repo?.inspection.remotes.find((item) => item.name === remoteName)?.pushUrl;
  const webAgent = props.config?.agents.find((item) => item.id === props.task.agentId);
  const openUrl = webAgent && webAgent.kind === 'web' ? webAgent.openUrl : null;
  const [link, setLink] = useState(props.task.remoteUrl ?? '');
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  const qc = useQueryClient();
  const running = props.task.status === 'running';
  const save = useMutation({
    meta: { silentError: true },
    mutationFn: () => api.setRemoteLink(props.task.id, link),
    onSuccess: async (task) => {
      await qc.invalidateQueries({ queryKey: detailKey(task.id) });
      setError(null);
    },
    onError: (caught) => setError({ id: Date.now(), text: errorMessage(caught) }),
  });
  const done = useMutation({
    meta: { silentError: true },
    mutationFn: () => api.completeRemoteTurn(props.task.id),
    onSuccess: async (task) => {
      await qc.invalidateQueries({ queryKey: detailKey(task.id) });
    },
    onError: (caught) => setError({ id: Date.now(), text: errorMessage(caught) }),
  });

  return (
    <section className="space-y-2 border-b border-neutral-200 p-3 text-sm">
      <p className="font-medium text-neutral-900">
        网页任务 · 第 {current?.index ?? props.task.turnCount} 轮 ·{' '}
        {running ? '等你在 AoneD 里操作' : taskStatusLabel(props.task.status)}
      </p>
      <p className="select-text text-neutral-700">
        分支 {props.task.branch ?? '尚未创建'}
        {pushUrl ? ` @ ${pushUrl}` : ''}
      </p>
      <p className="text-neutral-700">
        {remote && remote.kind === 'remote'
          ? `最新提交 ${remote.headCommit.slice(0, 8)} · 本轮 ${remote.newCommits} 个新提交`
          : '本轮还没有新提交'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!handoff || handoff.kind !== 'tool'}
          onClick={() => {
            if (!handoff || handoff.kind !== 'tool') return;
            void navigator.clipboard.writeText(handoff.output).then(
              () => toast.info('已复制'),
              (caught: unknown) => toast.error(errorMessage(caught)),
            );
          }}
        >
          复制提示词
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!openUrl}
          onClick={() => {
            if (!openUrl) return;
            void openExternal(openUrl).catch((caught: unknown) =>
              toast.error(errorMessage(caught)),
            );
          }}
        >
          打开 AoneD
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!props.task.remoteUrl}
          onClick={() => {
            if (!props.task.remoteUrl) return;
            void openExternal(props.task.remoteUrl).catch((caught: unknown) =>
              toast.error(errorMessage(caught)),
            );
          }}
        >
          打开会话
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-neutral-700" htmlFor="remote-link">
          会话链接
        </label>
        <input
          id="remote-link"
          name="remote-link"
          type="url"
          autoComplete="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          className={`h-8 min-w-48 flex-1 rounded-md border border-neutral-300 px-2 ${focusRing}`}
        />
        <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          保存
        </Button>
      </div>
      {running ? (
        <Button type="button" size="sm" disabled={done.isPending} onClick={() => done.mutate()}>
          {done.isPending ? '正在拉取…' : '完成本轮'}
        </Button>
      ) : null}
      {error ? (
        <p key={error.id} role="alert" className="select-text text-red-700">
          {error.text}
        </p>
      ) : null}
    </section>
  );
}
