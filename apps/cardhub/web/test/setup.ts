import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library leaves the DOM in place between tests; clean it up
// after each test so adjacent specs don't see stale containers.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement matchMedia, but several Tailwind-aware components
// (and any future hook that watches color-scheme / breakpoints) call it.
// A minimal stub keeps tests deterministic.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
