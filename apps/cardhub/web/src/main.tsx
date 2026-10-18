import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import * as Sentry from '@sentry/react';
import { appRoutes } from './app';
import { ErrorBoundary } from './components/error-boundary';
import { TrpcProvider } from './lib/trpc';
import './styles/globals.css';

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

// Initialise Sentry as early as possible so the ErrorBoundary's componentDidCatch
// hook (which calls Sentry.captureException) has a real client to talk to.
// When the runtime and build-time DSNs are unset, Sentry stays inert.
const runtimeConfig = typeof window !== 'undefined' ? window.__CARDHUB_CONFIG__ : undefined;
const sentryDsn =
  nonEmpty(runtimeConfig?.SENTRY_DSN) ??
  nonEmpty(import.meta.env.VITE_SENTRY_DSN as string | undefined);

if (sentryDsn) {
  const sentryRelease = nonEmpty(runtimeConfig?.GIT_SHA);

  Sentry.init({
    dsn: sentryDsn,
    environment:
      nonEmpty(runtimeConfig?.SENTRY_ENVIRONMENT) ??
      (import.meta.env.MODE as string) ??
      'development',
    release: sentryRelease,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found');
}

// Surface a11y issues to the developer console during local dev only. Real
// users never load axe-core (production bundle excludes the import via the
// dynamic-import-on-DEV branch below).
if (import.meta.env.DEV) {
  void Promise.all([import('react'), import('react-dom'), import('@axe-core/react')]).then(
    ([React, ReactDOM, axeMod]) => {
      const axe = (axeMod as { default: (r: unknown, rd: unknown, n: number) => void }).default;
      axe(React, ReactDOM, 1000);
    },
  );
}

const router = createBrowserRouter(appRoutes);

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary
      onError={(error, info) => {
        if (sentryDsn) {
          Sentry.captureException(error, {
            extra: { componentStack: info.componentStack },
          });
        }
      }}
    >
      <TrpcProvider>
        <RouterProvider router={router} />
      </TrpcProvider>
    </ErrorBoundary>
  </StrictMode>,
);
