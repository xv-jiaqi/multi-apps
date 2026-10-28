import type { TaskDto } from '@agent-hub/contract';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui-web';
import { useState, type ReactElement } from 'react';
import { api } from '../../api/api';
import { errorMessage } from '../../api/client';
import { detailKey } from '../../api/cache';
import { HubDialog } from '../../components/hub-dialog';
import { focusRing } from '../../lib/format';

export function ApplyDialog(props: {
  task: TaskDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const [merge, setMerge] = useState(false);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  const qc = useQueryClient();
  const apply = useMutation({
    meta: { silentError: true },
    mutationFn: () => api.applyTask(props.task.id, { merge }),
    onSuccess: async () => {
      setError(null);
      props.onOpenChange(false);
      await qc.invalidateQueries({ queryKey: detailKey(props.task.id) });
    },
    onError: (caught) => setError({ id: Date.now(), text: errorMessage(caught) }),
  });
  return (
    <HubDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="应用到本地分支"
      description="把任务分支上的改动应用到本地。不会推送。"
      footer={
        <Button type="button" disabled={apply.isPending} onClick={() => apply.mutate()}>
          {apply.isPending ? '正在应用…' : '应用'}
        </Button>
      }
    >
      <label className="flex items-center gap-2 text-sm text-neutral-800">
        <input
          type="checkbox"
          className={`size-4 ${focusRing}`}
          checked={merge}
          onChange={(event) => setMerge(event.target.checked)}
        />
        合并到当前分支
      </label>
      {error ? (
        <p key={error.id} role="alert" className="select-text mt-3 text-sm text-red-700">
          {error.text}
        </p>
      ) : null}
    </HubDialog>
  );
}
