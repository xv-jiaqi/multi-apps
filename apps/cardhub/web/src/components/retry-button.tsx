import { cn } from '@repo/ui-web';

/** Error wins over the first-load skeleton, including while a retry is in flight. */
export function queryFallback(query: { isError: boolean; isLoading: boolean }) {
  if (query.isError) return 'error' as const;
  if (query.isLoading) return 'loading' as const;
  return 'ready' as const;
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
