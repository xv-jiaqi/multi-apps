import { Component, type ErrorInfo, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { t } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { RetryButton } from './retry-button';

/**
 * Webpack names the failure `ChunkLoadError`. Vite, Firefox, and WebKit only
 * put a phrase in the message. `message` may be missing when the throw is not
 * an Error, so coerce it before calling `includes`.
 */
export function isChunkLoadError(error: unknown): boolean {
  const candidate = error as { name?: unknown; message?: unknown } | null | undefined;
  const message = String(candidate?.message ?? '');
  return (
    candidate?.name === 'ChunkLoadError' ||
    message.includes('dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('Unable to preload CSS') ||
    message.includes('Loading CSS chunk') ||
    message.includes('Loading chunk')
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Override the default fallback UI; receives the captured error. */
  fallback?: (error: unknown, reset: () => void) => ReactNode;
  /**
   * Side-effect hook invoked once when the boundary catches an error.
   * Wire this up to Sentry / Datadog / etc. once observability lands
   * (see plan v2 milestone M2.5).
   */
  onError?: (error: unknown, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  /** Separate from `error` so a thrown `null` still shows the fallback. */
  hasError: boolean;
  error: unknown;
}

/**
 * Generic error boundary. We use it twice in App: once at the root to catch
 * runtime crashes from any route, and once per lazy route to keep a single
 * page failure from taking down the whole app shell.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error, info);
    }
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
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
  error: unknown;
  onRetry: () => void;
}) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  return (
    <div
      role="alert"
      className="mx-auto mt-6 max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700"
    >
      <p className="font-medium">{tt('state.crashTitle')}</p>
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
          className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 min-h-6"
        />
        <a
          href="/"
          className="inline-flex min-h-6 items-center rounded px-1 font-medium text-brand-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {tt('state.crashHome')}
        </a>
      </div>
    </div>
  );
});
