import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { rootStore } from '../stores/root-store';

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    auth: {
      me: {
        useQuery: () => ({ data: undefined, refetch: vi.fn() }),
      },
    },
  },
}));

import { AppLayout } from '../app';
import { CHUNK_RETRY_PATH_KEY, ErrorBoundary } from './error-boundary';

function OutsideFocus() {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <button ref={ref} type="button">
      外面
    </button>
  );
}

function ChunkFault(): never {
  throw new Error('Loading chunk 12 failed.');
}

function Page({ fail }: { fail: boolean }) {
  return (
    <>
      <OutsideFocus />
      <ErrorBoundary>{fail ? <ChunkFault /> : <p>正常</p>}</ErrorBoundary>
    </>
  );
}

function renderPage(fail: boolean) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        children: [{ index: true, element: <Page fail={fail} /> }],
      },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  window.sessionStorage.removeItem(CHUNK_RETRY_PATH_KEY);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  window.sessionStorage.removeItem(CHUNK_RETRY_PATH_KEY);
  vi.restoreAllMocks();
});

describe('chunk reload retry focus', () => {
  it('focuses retry when the marker matches the pathname and the page is still in error', () => {
    window.sessionStorage.setItem(CHUNK_RETRY_PATH_KEY, window.location.pathname);
    renderPage(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '重试' }));
    expect(window.sessionStorage.getItem(CHUNK_RETRY_PATH_KEY)).toBeNull();
  });

  it('clears the marker and leaves focus alone when the page loads', () => {
    window.sessionStorage.setItem(CHUNK_RETRY_PATH_KEY, window.location.pathname);
    renderPage(false);
    expect(screen.getByText('正常')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '外面' }));
    expect(window.sessionStorage.getItem(CHUNK_RETRY_PATH_KEY)).toBeNull();
  });

  it('clears the marker and leaves focus alone when the pathname differs', () => {
    expect(window.location.pathname).not.toBe('/__chunk_retry_other__');
    window.sessionStorage.setItem(CHUNK_RETRY_PATH_KEY, '/__chunk_retry_other__');
    renderPage(true);
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '外面' }));
    expect(window.sessionStorage.getItem(CHUNK_RETRY_PATH_KEY)).toBeNull();
  });
});
