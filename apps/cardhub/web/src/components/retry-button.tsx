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

function shouldRestoreFocus(active: Element | null, target: HTMLElement | null) {
  if (active == null || active === document.body) return true;
  return target != null && active.contains(target);
}

/**
 * After the error view recovers, move focus to the content that replaced it
 * when focus is on the document or on an ancestor of that content. `#main` is
 * focusable and wraps every error box, so a click that lands there still
 * moves. An input that does not contain the content keeps focus. Read
 * activeElement after commit: removing the retry button moves it to body
 * before paint.
 */
export function useFocusOnRecovery(view: QueryView, targetRef: RefObject<HTMLElement | null>) {
  const previous = useRef(view);
  useLayoutEffect(() => {
    const recovered = previous.current === 'error' && view === 'ready';
    previous.current = view;
    const target = targetRef.current;
    if (!recovered || !shouldRestoreFocus(document.activeElement, target)) return;
    target?.focus({ preventScroll: true });
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
