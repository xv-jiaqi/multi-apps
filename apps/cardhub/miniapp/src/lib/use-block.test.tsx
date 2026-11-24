// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBlock } from './use-block';

type Load = () => Promise<void>;

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
