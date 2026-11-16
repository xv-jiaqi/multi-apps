import { vi } from 'vitest';

/** React Query's first retry delay with the default backoff. */
export const RETRY_DELAY_MS = 1_000;
/** Past the retry delay, so a retry that was going to happen has happened. */
export const PAST_RETRY_DELAY_MS = 5 * RETRY_DELAY_MS;

const realSetTimeout = globalThis.setTimeout;

/**
 * Fakes the timer functions only. `Date` and `performance` stay real, and
 * fetch mocks still resolve on the microtask queue.
 */
export function useFakeRetryClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
}

/**
 * Polls `check` while moving the fake clock 1ms per poll, so tRPC batching and
 * React Query notify timers run but the clock stays far below the retry delay.
 * Passing proves the state was reached without waiting for a retry.
 */
export async function untilBeforeRetryDelay(check: () => void): Promise<void> {
  const budgetMs = RETRY_DELAY_MS / 5;
  let lastError: unknown;
  for (let elapsed = 0; elapsed < budgetMs; elapsed += 1) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
    }
    await vi.advanceTimersByTimeAsync(1);
    await new Promise((resolve) => realSetTimeout(resolve, 5));
  }
  throw lastError;
}
