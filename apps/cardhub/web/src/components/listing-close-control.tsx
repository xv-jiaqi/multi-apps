import { useEffect, useId, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { t } from '@repo/shared';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

export const ListingCloseControl = observer(function ListingCloseControl({
  listingId,
  onClosed,
}: {
  listingId: string;
  onClosed?: (listingId: string) => void;
}) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const promptId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const close = trpc.listings.close.useMutation({
    onSuccess() {
      setConfirming(false);
      setErrorKey(null);
      onClosed?.(listingId);
    },
    onError(error) {
      if (error.data?.code === 'NOT_FOUND') {
        setConfirming(false);
        setErrorKey(null);
        onClosed?.(listingId);
        return;
      }
      setConfirming(false);
      setErrorKey(error.data?.code === 'FORBIDDEN' ? 'trade.closeForbidden' : 'trade.closeFailed');
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
    setConfirming(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  if (confirming) {
    return (
      <div
        role="group"
        aria-label={tt('trade.confirmClose')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            cancel();
          }
        }}
        className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs"
      >
        <span id={promptId} className="mr-auto text-red-700">
          {tt('trade.confirmClose')}
        </span>
        <button
          type="button"
          aria-describedby={promptId}
          disabled={close.isPending}
          onClick={() => close.mutate({ id: listingId })}
          className="inline-flex min-h-6 items-center rounded px-1 font-semibold text-red-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
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
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={tt('trade.closeAria')}
        onClick={() => {
          setErrorKey(null);
          setConfirming(true);
        }}
        className="rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {tt('trade.close')}
      </button>
      {errorKey ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {tt(errorKey)}
        </p>
      ) : null}
    </>
  );
});
