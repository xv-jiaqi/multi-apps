import { CappedMemoryStore } from './rate-limiters';

describe('in-process rate limit fallback', () => {
  it('caps new keys and still counts keys that are already stored', async () => {
    jest.useFakeTimers();
    const store = new CappedMemoryStore(2);
    store.init({ windowMs: 1_000 } as Parameters<CappedMemoryStore['init']>[0]);
    try {
      expect((await store.increment('a')).totalHits).toBe(1);
      expect((await store.increment('b')).totalHits).toBe(1);

      const blocked = await store.increment('c');
      expect(blocked.totalHits).toBe(Number.MAX_SAFE_INTEGER);
      expect(store.current.has('c')).toBe(false);
      expect(store.previous.has('c')).toBe(false);
      expect(store.current.size + store.previous.size).toBe(2);

      expect((await store.increment('a')).totalHits).toBe(2);

      await jest.advanceTimersByTimeAsync(1_000);
      const stillBlocked = await store.increment('c');
      expect(stillBlocked.totalHits).toBe(Number.MAX_SAFE_INTEGER);
      expect(store.current.has('c')).toBe(false);
      expect(store.current.has('a') || store.previous.has('a')).toBe(true);

      await jest.advanceTimersByTimeAsync(1_000);
      await jest.advanceTimersByTimeAsync(1_000);
      const fresh = await store.increment('c');
      expect(fresh.totalHits).toBe(1);
      expect(store.current.has('c')).toBe(true);
    } finally {
      store.shutdown();
      jest.useRealTimers();
    }
  });
});
