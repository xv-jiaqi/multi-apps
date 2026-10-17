import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { RetryButton, queryFallback, useFocusOnRecovery } from './retry-button';

type Gate<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createGate<T>(): Gate<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function FallbackView({
  view,
  errorMessage,
  fetching,
  readyText,
  onRetry,
}: {
  view: 'error' | 'loading' | 'ready';
  errorMessage: string | null;
  fetching: boolean;
  readyText: string;
  onRetry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusOnRecovery(view, headingRef);
  if (view === 'loading') return <p>加载中…</p>;
  if (view === 'error') {
    return (
      <div role="alert">
        <p>加载失败</p>
        {errorMessage ? <p>{errorMessage}</p> : null}
        <RetryButton retrying={fetching} label="重试" retryingLabel="重试中" onRetry={onRetry} />
      </div>
    );
  }
  return (
    <h1 ref={headingRef} tabIndex={-1}>
      {readyText}
    </h1>
  );
}

function QueryProbe({ gates }: { gates: Gate<string>[] }) {
  const query = useQuery({
    queryKey: ['retry-probe'],
    retry: false,
    queryFn: () => {
      const gate = createGate<string>();
      gates.push(gate);
      return gate.promise;
    },
  });
  return (
    <FallbackView
      view={queryFallback(query)}
      errorMessage={query.error instanceof Error ? query.error.message : null}
      fetching={query.isFetching}
      readyText={typeof query.data === 'string' ? query.data : ''}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}

function InfiniteProbe({ gates }: { gates: Gate<string>[] }) {
  const query = useInfiniteQuery({
    queryKey: ['retry-infinite'],
    retry: false,
    initialPageParam: 0,
    getNextPageParam: () => undefined,
    queryFn: () => {
      const gate = createGate<string>();
      gates.push(gate);
      return gate.promise;
    },
  });
  return (
    <FallbackView
      view={queryFallback(query)}
      errorMessage={query.error instanceof Error ? query.error.message : null}
      fetching={query.isFetching}
      readyText={query.data?.pages.join(',') ?? ''}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}

function renderProbe(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function expectRetryKeepsTheError(renderWith: (gates: Gate<string>[]) => ReactNode) {
  const gates: Gate<string>[] = [];
  renderProbe(renderWith(gates));
  await waitFor(() => expect(gates).toHaveLength(1));
  expect(screen.getByText('加载中…')).toBeInTheDocument();

  act(() => {
    gates[0]?.reject(new Error('first'));
  });
  const retry = await screen.findByRole('button', { name: '重试' });
  expect(screen.getByRole('alert')).toHaveTextContent('加载失败');
  expect(screen.getByRole('alert')).toHaveTextContent('first');

  const user = userEvent.setup();
  await user.click(retry);

  const busy = screen.getByRole('button', { name: '重试中' });
  expect(screen.getByRole('alert')).toHaveTextContent('加载失败');
  expect(screen.queryByText('加载中…')).not.toBeInTheDocument();
  expect(document.activeElement).toBe(busy);

  act(() => {
    gates[1]?.reject(new Error('second'));
  });
  await screen.findByRole('button', { name: '重试' });
  expect(screen.getByRole('alert')).toHaveTextContent('second');
  expect(screen.getByRole('alert')).not.toHaveTextContent('first');

  await user.click(screen.getByRole('button', { name: '重试' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '重试中' }));
  act(() => {
    gates[2]?.resolve('loaded');
  });
  const heading = await screen.findByRole('heading', { name: 'loaded' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(heading).toHaveFocus();
  expect(document.activeElement).not.toBe(document.body);
}

describe('queryFallback with a real QueryClient', () => {
  it('keeps the error view through a failed retry, then shows data', async () => {
    await expectRetryKeepsTheError((gates) => <QueryProbe gates={gates} />);
  });

  it('keeps the error view for an infinite query that has never resolved', async () => {
    await expectRetryKeepsTheError((gates) => <InfiniteProbe gates={gates} />);
  });
});
