import { Component, useRef, type ErrorInfo, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { t } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { PageShell } from './page-shell';
import { RetryButton, useFocusOnPersistentError } from './retry-button';

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
  /** Route crashes render inside the normal page shell. The root boundary does not. */
  withShell?: boolean;
  /**
   * While the boundary is showing an error, a new pathname clears it.
   * Search params and hashes leave the boundary mounted.
   */
  pathname?: string;
}

interface ErrorBoundaryState {
  /** Separate from `error` so a thrown `null` still shows the fallback. */
  hasError: boolean;
  error: unknown;
  /**
   * Set when Reset runs, kept when that render throws again, cleared once
   * the children render. The first catch stays false.
   */
  restoreFocus: boolean;
  /** Pathname captured while healthy, or when the error first appeared. */
  caughtPathname?: string;
}

/**
 * Generic error boundary. We use it twice in App: once at the root to catch
 * runtime crashes from any route, and once per lazy route to keep a single
 * page failure from taking down the whole app shell.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null, restoreFocus: false };

  static getDerivedStateFromError(error: unknown): Pick<ErrorBoundaryState, 'hasError' | 'error'> {
    return { hasError: true, error };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.pathname === undefined) return null;
    if (state.hasError && state.caughtPathname === undefined) {
      return { caughtPathname: props.pathname };
    }
    if (state.hasError && state.caughtPathname !== props.pathname) {
      return {
        hasError: false,
        error: null,
        restoreFocus: false,
        caughtPathname: props.pathname,
      };
    }
    if (!state.hasError && state.caughtPathname !== props.pathname) {
      return { caughtPathname: props.pathname };
    }
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    if (typeof console !== 'undefined') {
      console.error('[ErrorBoundary]', error, info);
    }
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null, restoreFocus: true });
  };

  override componentDidUpdate(): void {
    if (!this.state.hasError && this.state.restoreFocus) {
      this.setState({ restoreFocus: false });
    }
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.reset}
          restoreFocus={this.state.restoreFocus}
          withShell={this.props.withShell}
        />
      );
    }
    return this.props.children;
  }
}

/** Shared fallback for the root boundary and the data-router errorElement. */
export const ErrorFallback = observer(function ErrorFallback({
  error,
  onRetry,
  restoreFocus = false,
  withShell = false,
}: {
  error: unknown;
  onRetry: () => void;
  restoreFocus?: boolean;
  withShell?: boolean;
}) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const retryRef = useRef<HTMLButtonElement>(null);
  useFocusOnPersistentError(restoreFocus, retryRef);

  const alert = (
    <div
      role="alert"
      className="mx-auto mt-6 max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700"
    >
      <p className="font-medium">{tt('state.crashTitle')}</p>
      <p className="mt-1">{tt('state.crashBody')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <RetryButton
          ref={retryRef}
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
  if (withShell) return <PageShell>{alert}</PageShell>;
  return <div className="app-safe-x">{alert}</div>;
});
