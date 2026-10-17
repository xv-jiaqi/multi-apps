import { useLayoutEffect, useRef, type RefObject } from 'react';
import { cn } from '@repo/ui-web';

/**
 * A query that has never received data. `refetch()` clears `error` and sets
 * status back to pending, so `isError` is false while the retry is in flight.
 */
export interface QueryFallbackState {
  isError: boolean;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  errorUpdateCount: number;
  dataUpdatedAt: number;
}

export type QueryView = 'error' | 'loading' | 'ready';

function isInitialErrorRetry(query: QueryFallbackState) {
  return (
    query.isPending && query.isFetching && query.errorUpdateCount > 0 && query.dataUpdatedAt === 0
  );
}

/** Error wins over the first-load skeleton, including while a retry is in flight. */
export function queryFallback(...queries: QueryFallbackState[]): QueryView {
  if (queries.some((query) => query.isError || isInitialErrorRetry(query))) return 'error';
  if (queries.some((query) => query.isLoading)) return 'loading';
  return 'ready';
}

function shouldRestoreFocus(active: Element | null) {
  if (active == null || active === document.body) return true;
  return active instanceof HTMLElement && active.dataset.retryButton != null;
}

/**
 * After the error view recovers, move focus to the content that replaced it
 * only when it is still on the retry button or has already dropped to the
 * document. Read activeElement in a layout effect: removing the button moves
 * it to body before paint, while an input outside that tree stays focused.
 */
export function useFocusOnRecovery(view: QueryView, targetRef: RefObject<HTMLElement | null>) {
  const previous = useRef(view);
  useLayoutEffect(() => {
    const recovered = previous.current === 'error' && view === 'ready';
    previous.current = view;
    if (!recovered || !shouldRestoreFocus(document.activeElement)) return;
    targetRef.current?.focus();
  }, [view, targetRef]);
}

export function RetryButton({
  retrying,
  label,
  retryingLabel,
  onRetry,
  className,
}: {
  retrying: boolean;
  label: string;
  retryingLabel: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-retry-button=""
      aria-disabled={retrying || undefined}
      aria-busy={retrying || undefined}
      onClick={() => {
        if (retrying) return;
        onRetry();
      }}
      className={cn(className, retrying && 'pointer-events-none opacity-50')}
    >
      {retrying ? retryingLabel : label}
    </button>
  );
}
