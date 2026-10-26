import type { Ref } from 'react';
import { RetryButton } from './retry-button';

const tradeListRetryClassName =
  'mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/** Trade-list button classes plus min-h-6. Passed by the block-level error call sites. */
export const dataErrorRetryClassName =
  'mt-3 min-h-6 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

export function ErrorBox({
  title,
  retryLabel,
  retryingLabel,
  retrying,
  retry,
  headingAs = 'p',
  retryClassName = tradeListRetryClassName,
  retryRef,
}: {
  title: string;
  retryLabel: string;
  retryingLabel: string;
  retrying: boolean;
  retry: () => void;
  headingAs?: 'p' | 'h1';
  retryClassName?: string;
  retryRef?: Ref<HTMLButtonElement>;
}) {
  const Heading = headingAs;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700"
    >
      <Heading className="font-medium">{title}</Heading>
      <RetryButton
        ref={retryRef}
        retrying={retrying}
        label={retryLabel}
        retryingLabel={retryingLabel}
        onRetry={retry}
        className={retryClassName}
      />
    </div>
  );
}
