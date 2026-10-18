import { Component, type ErrorInfo, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { buttonVariants } from '@repo/ui-web';
import { t } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { RetryButton } from './retry-button';

/** Webpack names the failure `ChunkLoadError`. Vite puts the phrase in the message. */
export function isChunkLoadError(error: Error): boolean {
  const message = error.message;
  return (
    error.name === 'ChunkLoadError' ||
    message.includes('dynamically imported module') ||
    message.includes('Failed to fetch dynamically imported module')
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Override the default fallback UI; receives the captured error. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /**
   * Side-effect hook invoked once when the boundary catches an error.
   * Wire this up to Sentry / Datadog / etc. once observability lands
   * (see plan v2 milestone M2.5).
   */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Generic error boundary. We use it twice in App: once at the root to catch
 * runtime crashes from any route, and once per lazy route to keep a single
 * page failure from taking down the whole app shell.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error, info);
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return <ErrorFallback error={this.state.error} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

/** Shared fallback for the root boundary and the data-router errorElement. */
export const ErrorFallback = observer(function ErrorFallback({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  return (
    <div
      role="alert"
      className="mx-auto mt-6 max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"
    >
      <p className="font-semibold">{tt('state.crashTitle')}</p>
      <p className="mt-1">{tt('state.crashBody')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <RetryButton
          retrying={false}
          label={tt('state.retry')}
          retryingLabel={tt('state.retrying')}
          onRetry={() => {
            if (isChunkLoadError(error)) {
              window.location.reload();
              return;
            }
            onRetry();
          }}
          className={buttonVariants({ variant: 'outline' })}
        />
        <a
          href="/"
          className="font-medium text-brand-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          {tt('state.crashHome')}
        </a>
      </div>
    </div>
  );
});
