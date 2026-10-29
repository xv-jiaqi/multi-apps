import { observer } from 'mobx-react-lite';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '@repo/ui-web';
import { fieldErrorMessage, reportCreateInput, t, type ReportTargetType } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { useAppMutationError } from '../lib/app-mutation-error';
import { trpc } from '../lib/trpc';

interface ReportParts {
  trigger: ReactNode;
  form: ReactNode;
}

interface ReportButtonProps {
  targetType: ReportTargetType;
  targetId: string;
  children?: (parts: ReportParts) => ReactNode;
}

const triggerClassName =
  'inline-flex min-h-6 items-center rounded px-1 text-xs text-neutral-600 hover:text-neutral-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

const loginClassName =
  'inline-flex min-h-6 items-center rounded px-1 text-xs text-neutral-600 hover:text-neutral-900 hover:underline';

/**
 * Inline report control. The trigger stays mounted while the form is open so
 * focus can return to it. Pass children to put the form on the next row.
 */
export const ReportButton = observer(function ReportButton({
  targetType,
  targetId,
  children,
}: ReportButtonProps) {
  const { locale, session } = useStores();
  const location = useLocation();
  const presentError = useAppMutationError();
  const tt = (key: string) => t(locale.locale, key);
  const formId = useId();
  const errorId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const returnFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = trpc.reports.create.useMutation({
    onSuccess() {
      setSuccess(true);
      setOpen(false);
      setReason('');
      setError(null);
    },
    onError(err) {
      const message = presentError(err);
      if (message) setError(message);
    },
  });

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (success) statusRef.current?.focus();
  }, [success]);

  if (session.isBanned) {
    if (children) return children({ trigger: null, form: null });
    return null;
  }

  if (!session.isAuthenticated) {
    const trigger = (
      <Link
        to="/login"
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
        className={loginClassName}
      >
        {tt('report.button')}
      </Link>
    );
    if (children) return children({ trigger, form: null });
    return trigger;
  }

  function closeForm() {
    returnFocus.current = true;
    setOpen(false);
    setReason('');
    setError(null);
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
      setError(
        parsed.error.issues[0]
          ? fieldErrorMessage(locale.locale, parsed.error.issues[0].message)
          : tt('state.error'),
      );
      textareaRef.current?.focus();
      return;
    }
    mutation.mutate(parsed.data);
  };

  const trigger = success ? (
    <span
      ref={statusRef}
      role="status"
      tabIndex={-1}
      className="text-xs text-emerald-700 focus:outline-none"
    >
      {tt('report.success')}
    </span>
  ) : (
    <button
      ref={triggerRef}
      type="button"
      aria-expanded={open}
      aria-controls={open ? formId : undefined}
      onClick={() => setOpen(true)}
      className={triggerClassName}
    >
      {tt('report.button')}
    </button>
  );

  const form =
    open && !success ? (
      <form
        id={formId}
        onSubmit={onSubmit}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          closeForm();
        }}
        className="order-last mt-2 w-full min-w-0 basis-full space-y-2 rounded-md border border-neutral-200 bg-white p-3 text-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-600">
          {tt('report.title')}
        </p>
        <label className="block">
          <span className="sr-only">{tt('report.reasonLabel')}</span>
          <textarea
            ref={textareaRef}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={tt('report.reasonPlaceholder')}
            rows={3}
            maxLength={500}
            readOnly={mutation.isPending}
            aria-busy={mutation.isPending || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="w-full min-w-0 resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
        </label>
        {error ? (
          <p
            id={errorId}
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button type="button" onClick={closeForm} className={triggerClassName}>
            {tt('report.cancel')}
          </button>
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? tt('report.submitting') : tt('report.submit')}
          </Button>
        </div>
      </form>
    ) : null;

  if (children) return children({ trigger, form });

  return (
    <>
      {trigger}
      {form}
    </>
  );
});
