import { useEffect, useId, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { t } from '@repo/shared';
import { DeleteReasonField } from './delete-reason-field';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

export const ListingCloseControl = observer(function ListingCloseControl({
  listingId,
  confirming,
  showReason = false,
  onConfirmingChange,
  onClosed,
}: {
  listingId: string;
  confirming: boolean;
  showReason?: boolean;
  onConfirmingChange: (open: boolean) => void;
  onClosed?: (listingId: string) => void;
}) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const promptId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [reason, setReason] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const close = trpc.listings.close.useMutation({
    onSuccess() {
      setReason('');
      onConfirmingChange(false);
      setErrorKey(null);
      onClosed?.(listingId);
    },
    onError(error) {
      if (error.data?.code === 'NOT_FOUND') {
        setReason('');
        onConfirmingChange(false);
        setErrorKey(null);
        onClosed?.(listingId);
        return;
      }
      setErrorKey(error.data?.code === 'FORBIDDEN' ? 'trade.closeForbidden' : 'trade.closeFailed');
      if (showReason) return;
      onConfirmingChange(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    },
  });

  useEffect(() => {
    if (confirming) {
      requestAnimationFrame(() => cancelRef.current?.focus());
    }
  }, [confirming]);

  const cancel = () => {
    if (close.isPending) return;
    setReason('');
    onConfirmingChange(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div className="contents">
      {confirming ? null : (
        <button
          ref={triggerRef}
          type="button"
          aria-label={tt('trade.closeAria')}
          onClick={() => {
            setErrorKey(null);
            setReason('');
            onConfirmingChange(true);
          }}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {tt('trade.close')}
        </button>
      )}
      {confirming ? (
        <div
          role="group"
          aria-label={tt('trade.confirmClose')}
          aria-busy={close.isPending || undefined}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              cancel();
            }
          }}
          className={
            showReason
              ? 'mt-2 flex basis-full flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs'
              : 'mt-2 flex basis-full flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs'
          }
        >
          <span id={promptId} className={showReason ? 'text-red-700' : 'mr-auto text-red-700'}>
            {tt('trade.confirmClose')}
          </span>
          {showReason ? (
            <DeleteReasonField
              locale={locale.locale}
              value={reason}
              readOnly={close.isPending}
              onChange={setReason}
            />
          ) : null}
          <div className={showReason ? 'flex justify-end gap-3' : 'contents'}>
            <button
              type="button"
              aria-describedby={promptId}
              disabled={close.isPending}
              onClick={() => {
                const trimmed = reason.trim();
                close.mutate(
                  showReason && trimmed ? { id: listingId, reason: trimmed } : { id: listingId },
                );
              }}
              className="inline-flex min-h-6 items-center rounded px-1 font-semibold text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
            >
              {close.isPending ? tt('trade.closing') : tt('trade.close')}
            </button>
            <button
              ref={cancelRef}
              type="button"
              disabled={close.isPending}
              onClick={cancel}
              className="inline-flex min-h-6 items-center rounded px-1 text-neutral-600 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
            >
              {tt('trade.closeCancel')}
            </button>
          </div>
        </div>
      ) : null}
      {errorKey ? (
        <p
          role="alert"
          className="mt-2 basis-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {tt(errorKey)}
        </p>
      ) : null}
    </div>
  );
});
