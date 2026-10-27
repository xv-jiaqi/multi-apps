import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@repo/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  controlBase,
} from '@repo/ui-web';
import { useStores } from '../../stores/root-store';

export function BanUserDialog({
  mode,
  username,
  open,
  pending,
  alertMessage,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: {
  mode: 'ban' | 'unban';
  username: string;
  open: boolean;
  pending: boolean;
  alertMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState(false);
  const labelId = useId();
  const hintId = useId();
  const errorId = useId();
  const ban = mode === 'ban';

  useEffect(() => {
    if (open) return;
    setReason('');
    setFieldError(false);
  }, [open]);

  useEffect(() => {
    if (alertMessage) actionRef.current?.focus();
  }, [alertMessage]);

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setFieldError(true);
      reasonRef.current?.focus();
      return;
    }
    setFieldError(false);
    onConfirm(trimmed);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent
        size="md"
        variant={ban ? 'destructive' : 'default'}
        busy={pending}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          reasonRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {tt(ban ? 'admin.ban.title' : 'admin.unban.title', { user: username })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tt(ban ? 'admin.ban.body' : 'admin.unban.body')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="mt-4 space-y-1">
          <label htmlFor={labelId} className="text-sm font-medium text-neutral-800">
            {tt(ban ? 'admin.ban.reason' : 'admin.unban.reason')}
          </label>
          <textarea
            ref={reasonRef}
            id={labelId}
            rows={3}
            maxLength={500}
            value={reason}
            readOnly={pending}
            autoComplete="off"
            aria-invalid={fieldError || undefined}
            aria-describedby={fieldError ? `${hintId} ${errorId}` : hintId}
            onChange={(event) => {
              setReason(event.target.value);
              if (fieldError) setFieldError(false);
            }}
            className={`${controlBase} h-auto py-2`}
          />
          <div className="flex justify-between gap-3 text-xs text-neutral-600">
            <p id={hintId}>{tt('admin.ban.reasonHint')}</p>
            <span aria-live="off">{reason.length}/500</span>
          </div>
          {fieldError ? (
            <p id={errorId} className="text-xs text-red-700">
              {tt('admin.ban.reasonRequired')}
            </p>
          ) : null}
        </div>
        {alertMessage ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {alertMessage}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {tt('admin.cancel')}
            </Button>
          </AlertDialogCancel>
          <Button
            ref={actionRef}
            type="button"
            variant={ban ? 'destructive' : 'default'}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={submit}
          >
            {pending
              ? tt(ban ? 'admin.ban.pending' : 'admin.unban.pending')
              : tt(ban ? 'admin.ban.confirm' : 'admin.unban.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
