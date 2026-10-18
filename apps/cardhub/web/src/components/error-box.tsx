import { RetryButton } from './retry-button';

export function ErrorBox({
  title,
  retryLabel,
  retryingLabel,
  retrying,
  retry,
  headingAs = 'p',
}: {
  title: string;
  retryLabel: string;
  retryingLabel: string;
  retrying: boolean;
  retry: () => void;
  headingAs?: 'p' | 'h1';
}) {
  const Heading = headingAs;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700"
    >
      <Heading className="font-medium">{title}</Heading>
      <RetryButton
        retrying={retrying}
        label={retryLabel}
        retryingLabel={retryingLabel}
        onRetry={retry}
        className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      />
    </div>
  );
}
