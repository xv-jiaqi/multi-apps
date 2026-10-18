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
    captureSentryException(error);
  }, [error]);

  return (
    <ErrorFallback
      error={error}
      onRetry={() => {
        navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true });
      }}
    />
  );
}
