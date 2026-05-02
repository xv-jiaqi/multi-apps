import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import * as Sentry from '@sentry/react';
import { App } from './app';
import { ErrorBoundary } from './components/error-boundary';
import { TrpcProvider } from './lib/trpc';
import './styles/globals.css';

// Initialise Sentry as early as possible so the ErrorBoundary's componentDidCatch
// hook (which calls Sentry.captureException) has a real client to talk to.
// When VITE_SENTRY_DSN is unset (local dev, demo builds) Sentry stays inert.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: (import.meta.env.MODE as string) || 'development',
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
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TrpcProvider>
    </ErrorBoundary>
  </StrictMode>,
);
