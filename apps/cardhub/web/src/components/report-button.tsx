import { observer } from 'mobx-react-lite';
import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '@repo/ui-web';
import { reportCreateInput, t, type ReportTargetType } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { useAppMutationError } from '../lib/app-mutation-error';
import { trpc } from '../lib/trpc';

interface ReportButtonProps {
  targetType: ReportTargetType;
  targetId: string;
}

/**
 * Lightweight inline reporter. Renders an unobtrusive "举报" link next to
 * user-generated content (listings, topics, replies, comments). Anonymous
 * users see the same link but get bounced to /login on click — we keep the
 * surface present so it's discoverable without a tooltip.
 */
export const ReportButton = observer(function ReportButton({
  targetType,
  targetId,
}: ReportButtonProps) {
  const { locale, session } = useStores();
  const location = useLocation();
  const presentError = useAppMutationError();
  const tt = (key: string) => t(locale.locale, key);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = trpc.reports.create.useMutation({
    onSuccess() {
      setSuccess(true);
      setOpen(false);
      setReason('');
    },
    onError(err) {
      const message = presentError(err);
      if (message) setError(message);
    },
  });

  if (session.isBanned) return null;

  if (!session.isAuthenticated) {
    return (
      <Link
        to="/login"
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
        className="inline-flex min-h-6 items-center rounded px-1 text-xs text-neutral-600 hover:text-neutral-900 hover:underline"
      >
        {tt('report.button')}
      </Link>
    );
  }

  if (success) {
    return <span className="text-xs text-emerald-700">{tt('report.success')}</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-6 items-center rounded px-1 text-xs text-neutral-600 hover:text-neutral-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {tt('report.button')}
      </button>
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = reportCreateInput.safeParse({
      targetType,
      targetId,
      reason: reason.trim(),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? tt('state.error'));
      return;
    }
    mutation.mutate(parsed.data);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-2 rounded-md border border-neutral-200 bg-white p-3 text-sm"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-600">
        {tt('report.title')}
      </p>
      <label className="block">
        <span className="sr-only">{tt('report.reasonLabel')}</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={tt('report.reasonPlaceholder')}
          rows={3}
          maxLength={500}
          className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
        />
      </label>
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-xs text-neutral-600 hover:text-neutral-900"
        >
          {tt('report.cancel')}
        </button>
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? tt('report.submitting') : tt('report.submit')}
        </Button>
      </div>
    </form>
  );
});
