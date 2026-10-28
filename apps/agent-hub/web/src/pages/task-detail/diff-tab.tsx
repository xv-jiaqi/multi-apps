import { diffFileStatusLabel, type TaskDetailDto } from '@agent-hub/contract';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui-web';
import { useState, type ReactElement } from 'react';
import { api } from '../../api/api';
import { ApiError, errorMessage } from '../../api/client';
import { taskDiffQuery } from '../../api/queries';
import { filePatchCollapsed, pairFilePatches } from '../../lib/patch';
import { focusRing } from '../../lib/format';

export function DiffTab(props: { task: TaskDetailDto }): ReactElement {
  const [scope, setScope] = useState<'task' | 'turn'>('task');
  const [turn, setTurn] = useState<number | null>(props.task.turns.at(-1)?.index ?? null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const diff = useQuery(taskDiffQuery(props.task.id, scope, scope === 'turn' ? turn : null));
  const qc = useQueryClient();
  const running = props.task.status === 'preparing' || props.task.status === 'running';

  async function refreshLive(): Promise<void> {
    try {
      const next = await api.getTaskDiff(props.task.id, {
        scope,
        turn: turn ?? undefined,
        live: true,
      });
      qc.setQueryData(
        taskDiffQuery(props.task.id, scope, scope === 'turn' ? turn : null).queryKey,
        next,
      );
    } catch (error) {
      qc.setQueryData(
        taskDiffQuery(props.task.id, scope, scope === 'turn' ? turn : null).queryKey,
        undefined,
      );
      throw error;
    }
  }

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={scope}
          onValueChange={(value) =>
            value === 'task' || value === 'turn' ? setScope(value) : undefined
          }
        >
          <SelectTrigger aria-label="diff 范围" size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" side="bottom" align="start">
            <SelectItem value="task">整个任务</SelectItem>
            <SelectItem value="turn">单轮</SelectItem>
          </SelectContent>
        </Select>
        {scope === 'turn' ? (
          <Select
            value={turn ? String(turn) : undefined}
            onValueChange={(value) => setTurn(Number(value))}
          >
            <SelectTrigger aria-label="轮次" size="sm" className="w-28">
              <SelectValue placeholder="轮次" />
            </SelectTrigger>
            <SelectContent position="popper" side="bottom" align="start">
              {props.task.turns.map((item) => (
                <SelectItem key={item.id} value={String(item.index)}>
                  第 {item.index} 轮
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {running ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refreshLive().catch(() => undefined)}
          >
            刷新 diff
          </Button>
        ) : null}
      </div>
      {diff.isError ? (
        diff.error instanceof ApiError && diff.error.code === 'DIFF_NOT_AVAILABLE' ? (
          <p className="text-sm text-neutral-700">本轮结束后才有 diff</p>
        ) : (
          <div role="alert" className="space-y-2">
            <p className="select-text text-sm text-red-700">{errorMessage(diff.error)}</p>
            <button
              type="button"
              className={`h-8 rounded-md border px-3 text-sm ${focusRing}`}
              onClick={() => void diff.refetch()}
            >
              重试
            </button>
          </div>
        )
      ) : null}
      {diff.isLoading ? <p className="text-sm text-neutral-700">正在加载 diff…</p> : null}
      {diff.data?.truncated ? <p className="text-sm text-amber-800">diff 已截断</p> : null}
      {diff.data && diff.data.patch === null ? (
        <p className="text-sm text-neutral-700">
          超过 5 MB，只有统计：{diff.data.stats.filesChanged} 个文件
        </p>
      ) : null}
      {diff.data?.patch
        ? pairFilePatches(diff.data.patch).map((file) => {
            const collapsed = filePatchCollapsed(file, expanded.has(file.path));
            return (
              <section key={file.path} className="rounded-md border border-neutral-200">
                <button
                  type="button"
                  className={`flex h-8 w-full items-center gap-2 px-3 text-left text-sm ${focusRing}`}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(file.path)) next.delete(file.path);
                      else next.add(file.path);
                      return next;
                    })
                  }
                >
                  <span>{diffFileStatusLabel(file.status)}</span>
                  <span className="select-text font-mono">{file.path}</span>
                  {file.oldPath ? <span className="text-neutral-600">← {file.oldPath}</span> : null}
                </button>
                {collapsed ? null : (
                  <pre className="select-text overflow-auto border-t border-neutral-200 p-3 font-mono text-xs text-neutral-800">
                    {file.text}
                  </pre>
                )}
              </section>
            );
          })
        : null}
    </div>
  );
}
