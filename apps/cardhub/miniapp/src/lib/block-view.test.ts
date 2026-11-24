import { describe, expect, it } from 'vitest';
import { resolveBlockView } from './block-view';

describe('resolveBlockView', () => {
  it('shows the failure box while a retry is in flight, not the skeleton', () => {
    expect(
      resolveBlockView({
        state: { data: null, failure: { id: 1, kind: 'failed' }, loading: true },
        isEmpty: () => true,
      }),
    ).toEqual({ kind: 'failed', noticeId: 1, retrying: true });
  });

  it('keeps not found apart from the failure box', () => {
    expect(
      resolveBlockView({
        state: { data: null, failure: { id: 2, kind: 'notFound' }, loading: false },
        isEmpty: () => true,
      }),
    ).toEqual({ kind: 'notFound' });
  });

  it('shows the skeleton on first load', () => {
    expect(
      resolveBlockView({
        state: { data: null, failure: null, loading: true },
        isEmpty: () => true,
      }),
    ).toEqual({ kind: 'loading' });
  });

  it('keeps data on screen during a background refresh', () => {
    expect(
      resolveBlockView<string[]>({
        state: { data: ['a'], failure: null, loading: true },
        isEmpty: (items) => items.length === 0,
      }),
    ).toEqual({ kind: 'success', data: ['a'] });
  });

  it('never falls into the empty state after a failure', () => {
    const view = resolveBlockView<string[]>({
      state: { data: [], failure: { id: 3, kind: 'failed' }, loading: false },
      isEmpty: (items) => items.length === 0,
    });
    expect(view.kind).toBe('failed');
  });

  it('separates empty and success', () => {
    expect(
      resolveBlockView<string[]>({
        state: { data: [], failure: null, loading: false },
        isEmpty: (items) => items.length === 0,
      }),
    ).toEqual({ kind: 'empty' });
    expect(
      resolveBlockView<string[]>({
        state: { data: ['a'], failure: null, loading: false },
        isEmpty: (items) => items.length === 0,
      }),
    ).toEqual({ kind: 'success', data: ['a'] });
  });
});
