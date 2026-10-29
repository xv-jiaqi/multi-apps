import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { lazy, useLayoutEffect, useRef, useState } from 'react';
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
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import { AppLayout, LazyRoute } from '../app';
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
  if (!fail) {
    return (
      <>
        <OutsideFocus />
        <LazyRoute name="/ok">
          <p>正常</p>
        </LazyRoute>
      </>
    );
  }
  return (
    <>
      <OutsideFocus />
      <ErrorBoundary>
        <ChunkFault />
      </ErrorBoundary>
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

function rejectAfterTick(error: Error) {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(error), 0);
  });
}

function resolveAfterTick<T>(value: T) {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), 0);
  });
}

function AsyncLazy({ fail }: { fail: boolean }) {
  const [Load] = useState(() =>
    lazy(() =>
      fail
        ? rejectAfterTick(new Error('Failed to fetch dynamically imported module: /assets/card.js'))
        : resolveAfterTick({
            default: function Resolved() {
              return <p>正常</p>;
            },
          }),
    ),
  );
  return (
    <LazyRoute name="/cards/async">
      <Load />
    </LazyRoute>
  );
}

function renderAsync(fail: boolean) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        children: [{ index: true, element: <AsyncLazy fail={fail} /> }],
      },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
}

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

  it('focuses retry when an async chunk reject arrives after mount', async () => {
    window.sessionStorage.setItem(CHUNK_RETRY_PATH_KEY, window.location.pathname);
    renderAsync(true);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CHUNK_RETRY_PATH_KEY)).toBe(window.location.pathname);

    const retry = await screen.findByRole('button', { name: '重试' });
    expect(document.activeElement).toBe(retry);
    expect(document.activeElement).not.toBe(document.body);
    expect(window.sessionStorage.getItem(CHUNK_RETRY_PATH_KEY)).toBeNull();
  });

  it('clears the marker after an async lazy page resolves and does not move focus', async () => {
    window.sessionStorage.setItem(CHUNK_RETRY_PATH_KEY, window.location.pathname);
    renderAsync(false);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CHUNK_RETRY_PATH_KEY)).toBe(window.location.pathname);
    expect(document.activeElement).toBe(document.body);

    expect(await screen.findByText('正常')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CHUNK_RETRY_PATH_KEY)).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
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
