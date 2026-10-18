import { Component, type ErrorInfo, type ReactNode } from 'react';

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
export function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="m-6 max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"
    >
      <p className="font-semibold">出现了错误 / Something went wrong</p>
      <p className="mt-1 break-all text-xs opacity-80">{error.message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        重试 / Retry
      </button>
    </div>
  );
}
