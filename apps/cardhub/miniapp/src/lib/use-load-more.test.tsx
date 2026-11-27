// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLoadMore, type LoadMorePage } from './use-load-more';

type Item = { id: string };

type Api = ReturnType<typeof useLoadMore<Item>>;

function harness() {
  const ref: { api: Api | null } = { api: null };
  function Probe() {
    ref.api = useLoadMore<Item>();
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

function page(ids: string[], nextCursor: string | null): LoadMorePage<Item> {
  return { items: ids.map((id) => ({ id })), nextCursor };
}

describe('useLoadMore', () => {
  it('same-tick bursts send one request and do not duplicate items', async () => {
    const pending = deferred<LoadMorePage<Item>>();
    const fetchPage = vi.fn((cursor: string) => {
      expect(cursor).toBe('c1');
      return pending.promise;
    });
    const box = harness();
    act(() => {
      void box.api!.loadMore({ cursor: 'c1', fetchPage, failedText: 'fail' });
      void box.api!.loadMore({ cursor: 'c1', fetchPage, failedText: 'fail' });
      void box.api!.loadMore({ cursor: 'c1', fetchPage, failedText: 'fail' });
      void box.api!.loadMore({ cursor: 'c1', fetchPage, failedText: 'fail' });
      void box.api!.loadMore({ cursor: 'c1', fetchPage, failedText: 'fail' });
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(page(['a', 'b', 'c'], 'c2'));
      await pending.promise;
    });
    expect(box.api!.extra.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(box.api!.moreCursor).toBe('c2');
    expect(box.api!.moreLoading).toBe(false);
  });

  it('reset during an in-flight page drops that page so it is not appended after a refresh', async () => {
    const stale = deferred<LoadMorePage<Item>>();
    const fetchPage = vi.fn(() => stale.promise);
    const box = harness();
    act(() => {
      void box.api!.loadMore({ cursor: 'old', fetchPage, failedText: 'fail' });
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    act(() => {
      box.api!.reset();
    });
    expect(box.api!.extra).toEqual([]);
    expect(box.api!.moreLoading).toBe(false);
    await act(async () => {
      stale.resolve(page(['old-21', 'old-22', 'old-23'], null));
      await stale.promise;
    });
    expect(box.api!.extra).toEqual([]);
    expect(box.api!.moreCursor).toBeNull();
  });
});
