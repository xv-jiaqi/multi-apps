import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import * as Sentry from '@sentry/react';
import { appRoutes } from './app';
import { ErrorBoundary } from './components/error-boundary';
import {
  captureSentryException,
  readSentryDsn,
  readSentryEnvironment,
  readSentryRelease,
} from './lib/sentry';
import { TrpcProvider } from './lib/trpc';
import './styles/globals.css';

// Initialise Sentry as early as possible so error reporting has a real client.
// When the runtime and build-time DSNs are unset, Sentry stays inert.
const sentryDsn = readSentryDsn();

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: readSentryEnvironment(),
    release: readSentryRelease(),
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
        captureSentryException(error, {
          componentStack: info.componentStack ?? '',
        });
      }}
    >
      <TrpcProvider>
        <RouterProvider router={router} />
      </TrpcProvider>
    </ErrorBoundary>
  </StrictMode>,
);
