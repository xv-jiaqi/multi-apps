import { describe, expect, it } from 'vitest';
import { createLoadMoreGuard } from './load-more-guard';

describe('createLoadMoreGuard (CH-301 v1.4 load more)', () => {
  it('same-tick bursts only start one request', () => {
    const guard = createLoadMoreGuard();
    const tokens = Array.from({ length: 5 }, () => guard.tryStart());
    expect(tokens.filter((token) => token !== null)).toEqual([0]);
  });

  it('allows another request after the current one finishes', () => {
    const guard = createLoadMoreGuard();
    const first = guard.tryStart();
    expect(first).toBe(0);
    expect(guard.tryStart()).toBeNull();
    guard.finish(first!);
    expect(guard.tryStart()).toBe(0);
  });

  it('drops a stale page after invalidate (tab leave / filter change)', () => {
    const guard = createLoadMoreGuard();
    const stale = guard.tryStart();
    expect(stale).toBe(0);
    guard.invalidate();
    expect(guard.isCurrent(stale!)).toBe(false);
    const next = guard.tryStart();
    expect(next).toBe(1);
    guard.finish(stale!);
    expect(guard.tryStart()).toBeNull();
    guard.finish(next!);
    expect(guard.tryStart()).toBe(1);
  });
});
