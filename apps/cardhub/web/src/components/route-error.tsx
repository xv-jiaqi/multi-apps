import { useEffect, useMemo } from 'react';
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router';
import { ErrorFallback } from './error-boundary';
import { captureSentryException } from '../lib/sentry';

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (isRouteErrorResponse(value)) {
    return new Error(`${value.status} ${value.statusText}`);
  }
  return new Error('Unknown error');
}

/**
 * Data-router errors (HomePage, AuthBootstrap) never reach the root
 * ErrorBoundary. Reuse its fallback and report the same way.
 */
export function RouteErrorFallback() {
  const routeError = useRouteError();
  const error = useMemo(() => toError(routeError), [routeError]);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    console.error(error);
    captureSentryException(error);
  }, [error]);

  const crashRetry = readCrashRetry(location.state);

  return (
    <ErrorFallback
      withShell
      error={error}
      restoreFocus={crashRetry > 0}
      onRetry={() => {
        const previous =
          typeof location.state === 'object' && location.state !== null
            ? (location.state as Record<string, unknown>)
            : {};
        navigate(`${location.pathname}${location.search}${location.hash}`, {
          replace: true,
          state: { ...previous, crashRetry: crashRetry + 1 },
        });
      }}
    />
  );
}

function readCrashRetry(state: unknown): number {
  if (typeof state !== 'object' || state === null || !('crashRetry' in state)) return 0;
  const value = state.crashRetry;
  return typeof value === 'number' && value > 0 ? value : 0;
}
