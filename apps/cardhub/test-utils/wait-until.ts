/**
 * Poll until an observable condition holds, then return that sample.
 * Focus tests call this before they assert, so they see a remounted retry
 * button or a request count that has already increased.
 * The loop yields between samples. It does not wait out a fixed delay and
 * then assert.
 */
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_INTERVAL_MS = 0;

export type WaitUntilOptions = {
  /** Milliseconds between samples. Default 0, the previous yield. */
  interval?: number;
  /** Milliseconds before throwing. Default 5000. */
  timeout?: number;
};

export async function waitUntil<T>(
  read: () => T | Promise<T>,
  until: (value: T) => boolean,
  label = 'observable condition',
  options: WaitUntilOptions = {},
): Promise<T> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const interval = options.interval ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeout;
  let detail = 'no sample';
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (until(value)) return value;
      detail = 'condition still false';
    } catch (error) {
      detail = error instanceof Error ? error.message : 'read failed';
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, interval);
    });
  }
  throw new Error(`timed out waiting for ${label}: ${detail}`);
}
