import {
  approvalDecisionLabel,
  approvalStatusLabel,
  deciderLabel,
  type ApprovalDecision,
  type ApprovalDto,
} from '@agent-hub/contract';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui-web';
import { useState, type ReactElement } from 'react';
import { api } from '../../api/api';
import { ApiError, errorMessage } from '../../api/client';
import { detailKey, pendingKey } from '../../api/cache';
import { useNow } from '../../app/hooks';
import { focusRing, formatDuration, formatTime } from '../../lib/format';

export function ApprovalCard(props: { approval: ApprovalDto; taskId: string }): ReactElement {
  const now = useNow(30_000);
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const [open, setOpen] = useState(props.approval.status === 'pending');
  const decide = useMutation({
    meta: { silentError: true },
    mutationFn: (decision: ApprovalDecision) => api.decideApproval(props.approval.id, { decision }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: detailKey(props.taskId) });
      await qc.invalidateQueries({ queryKey: pendingKey() });
    },
    onError: async (error) => {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === 'APPROVAL_NOT_PENDING'
      ) {
        setNotice({ id: Date.now(), text: '已被处理' });
        await qc.invalidateQueries({ queryKey: detailKey(props.taskId) });
        await qc.invalidateQueries({ queryKey: pendingKey() });
        return;
      }
      setNotice({ id: Date.now(), text: errorMessage(error) });
    },
  });

  if (props.approval.status !== 'pending' && !open) {
    return (
      <button
        type="button"
        className={`block w-full rounded-md border border-neutral-200 p-2 text-left text-sm ${focusRing}`}
        onClick={() => setOpen(true)}
      >
        {props.approval.title} ·{' '}
        {props.approval.decision
          ? approvalDecisionLabel(props.approval.decision)
          : approvalStatusLabel(props.approval.status)}
        {props.approval.decidedBy ? ` · ${deciderLabel(props.approval.decidedBy)}` : ''}
        {props.approval.resolvedAt ? ` · ${formatTime(props.approval.resolvedAt, now)}` : ''}
      </button>
    );
  }

  const remaining = Date.parse(props.approval.expiresAt) - now;
  return (
    <article className="space-y-2 rounded-md border border-neutral-200 p-3 text-sm">
      <h3 className="font-medium text-neutral-900">{props.approval.title}</h3>
      {props.approval.command ? (
        <p className="select-text font-mono text-neutral-800">{props.approval.command}</p>
      ) : null}
      {props.approval.cwd ? (
        <p className="select-text text-neutral-600">目录 {props.approval.cwd}</p>
      ) : null}
      {props.approval.paths ? (
        <p className="select-text text-neutral-600">{props.approval.paths.join('、')}</p>
      ) : null}
      {props.approval.reason ? (
        <p className="select-text text-neutral-700">{props.approval.reason}</p>
      ) : null}
      {props.approval.status === 'pending' ? (
        <p className="text-neutral-600">
          {remaining > 0 ? `剩余 ${formatDuration(remaining)}` : '已到时间'}
        </p>
      ) : (
        <p className="text-neutral-600">
          {props.approval.decidedBy ? deciderLabel(props.approval.decidedBy) : ''}
          {props.approval.resolvedAt ? ` · ${formatTime(props.approval.resolvedAt, now)}` : ''}
        </p>
      )}
      {notice ? (
        <p key={notice.id} role="alert" className="select-text text-red-700">
          {notice.text}
        </p>
      ) : null}
      {props.approval.status === 'pending' ? (
        <div className="flex flex-wrap gap-2">
          {props.approval.options.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={option === 'reject' || option === 'cancel_turn' ? 'outline' : 'default'}
              disabled={decide.isPending}
              onClick={() => decide.mutate(option)}
            >
              {approvalDecisionLabel(option)}
            </Button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
