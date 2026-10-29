import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

declare module 'vitest/browser' {
  interface BrowserCommands {
    clickInFrame: (name: string) => Promise<void>;
    pressEnterInFrame: (name: string) => Promise<void>;
  }
}
import { ErrorBoundary } from './error-boundary';
import { RouteErrorFallback } from './route-error';

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: false,
        }),
      },
    },
  },
}));

function PermanentFault(): never {
  throw new Error('permanent-fault');
}

function FocusProbe({ onArm }: { onArm: () => void }) {
  return (
    <button type="button" onClick={onArm}>
      外面
    </button>
  );
}

function BoundaryHarness() {
  const [fail, setFail] = useState(false);
  return (
    <>
      <FocusProbe onArm={() => setFail(true)} />
      <ErrorBoundary>{fail ? <PermanentFault /> : <p>正常</p>}</ErrorBoundary>
    </>
  );
}

function renderRouter(initial: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        errorElement: <RouteErrorFallback />,
        children: [
          { index: true, element: <p>正常</p> },
          { path: '/boom', element: <PermanentFault /> },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  render(
    <>
      <button type="button">外面</button>
      <RouterProvider router={router} />
    </>,
  );
  return router;
}

async function pressEnterOnRetry(times: number) {
  let current = screen.getByRole('button', { name: '重试' });
  current.focus();
  expect(document.activeElement).toBe(current);

  for (let attempt = 0; attempt < times; attempt += 1) {
    await commands.pressEnterInFrame('重试');
    const next = screen.getByRole('button', { name: '重试' });
    expect(next, `attempt ${attempt + 1}`).not.toBe(current);
    expect(document.activeElement, `attempt ${attempt + 1}`).toBe(next);
    expect(next.matches(':focus-visible'), `attempt ${attempt + 1}`).toBe(true);
    current = next;
  }
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('crash page retry focus', () => {
  it('ErrorBoundary focuses Retry after a pointer retry without the focus ring', async () => {
    render(
      <ErrorBoundary>
        <PermanentFault />
      </ErrorBoundary>,
    );
    const previous = screen.getByRole('button', { name: '重试' });
    await commands.clickInFrame('重试');
    const next = screen.getByRole('button', { name: '重试' });
    expect(next).not.toBe(previous);
    expect(document.activeElement).toBe(next);
    expect(next.matches(':focus-visible')).toBe(false);
  });

  it('ErrorBoundary does not move focus on the first error', async () => {
    render(<BoundaryHarness />);
    const outside = screen.getByRole('button', { name: '外面' });
    outside.focus();
    await userEvent.click(outside);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.activeElement).toBe(outside);
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '重试' }));
  });

  it('ErrorBoundary focuses the remounted Retry button after Enter', async () => {
    render(
      <ErrorBoundary>
        <PermanentFault />
      </ErrorBoundary>,
    );
    await pressEnterOnRetry(3);
  });

  it('data-router errorElement does not move focus on the first error', async () => {
    const router = renderRouter('/');
    const outside = screen.getByRole('button', { name: '外面' });
    outside.focus();
    await act(async () => {
      await router.navigate('/boom');
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.activeElement).toBe(outside);
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '重试' }));
  });

  it('data-router errorElement focuses the remounted Retry button after Enter', async () => {
    renderRouter('/boom');
    await pressEnterOnRetry(3);
  });
});
