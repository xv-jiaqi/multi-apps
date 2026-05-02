import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app';
import { ErrorBoundary } from './components/error-boundary';
import { TrpcProvider } from './lib/trpc';
import './styles/globals.css';

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
    <ErrorBoundary>
      <TrpcProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TrpcProvider>
    </ErrorBoundary>
  </StrictMode>,
);
