// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBlock } from './use-block';

type Load = (options?: { fresh?: boolean }) => Promise<void>;

function harness(fetcher: () => Promise<string>) {
  const ref: { load: Load | null; state: unknown } = { load: null, state: null };
  function Probe() {
    const block = useBlock(fetcher);
    ref.load = block.load;
    ref.state = block.state;
    return null;
  }
  render(<Probe />);
  return ref;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useBlock.load in-flight guard', () => {
  it('sends one request for concurrent load() calls and settles both callers', async () => {
    const pending = deferred<string>();
    const fetcher = vi.fn(() => pending.promise);
    const block = harness(fetcher);
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = block.load!();
      second = block.load!();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve('ok');
      await Promise.all([first, second]);
    });
    expect(block.state).toMatchObject({ data: 'ok', failure: null, loading: false });
  });

  it('allows a new request once the previous one has finished', async () => {
    const fetcher = vi.fn(async () => 'ok');
    const block = harness(fetcher);
    await act(async () => {
      await block.load!();
    });
    await act(async () => {
      await block.load!();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('allows a retry after a failure', async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    const block = harness(fetcher);
    await act(async () => {
      await block.load!();
    });
    expect(block.state).toMatchObject({ data: null, loading: false });
    await act(async () => {
      await block.load!();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(block.state).toMatchObject({ data: 'ok', failure: null });
  });
});

describe('useBlock.load after a write and on sync errors', () => {
  it('fresh: sends a new request while one is running, and the stale answer is dropped', async () => {
    const stale = deferred<string>();
    const fresh = deferred<string>();
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const block = harness(fetcher);
    let mount!: Promise<void>;
    let refresh!: Promise<void>;
    act(() => {
      mount = block.load!();
      refresh = block.load!({ fresh: true });
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => {
      fresh.resolve('with my comment');
      await refresh;
    });
    await act(async () => {
      stale.resolve('without my comment');
      await mount;
    });
    expect(block.state).toMatchObject({ data: 'with my comment', loading: false });
  });

  it('plain load() during a fresh request joins it', async () => {
    const pending = deferred<string>();
    const fetcher = vi.fn(() => pending.promise);
    const block = harness(fetcher);
    act(() => {
      void block.load!({ fresh: true });
      void block.load!();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve('ok');
      await pending.promise;
    });
  });

  it('retries after a fetcher that throws synchronously', async () => {
    let calls = 0;
    const fetcher = vi.fn((): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new Error('sync boom');
      return Promise.resolve('ok');
    });
    const block = harness(fetcher);
    await act(async () => {
      await block.load!();
    });
    expect(block.state).toMatchObject({ data: null, loading: false });
    await act(async () => {
      await block.load!();
    });
    await act(async () => {
      await block.load!();
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(block.state).toMatchObject({ data: 'ok', failure: null, loading: false });
  });
});
