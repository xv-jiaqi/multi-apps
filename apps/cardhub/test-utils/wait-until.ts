/**
 * Poll until an observable condition holds, then return that sample.
 * Focus tests call this before they assert, so they see a remounted retry
 * button or a request count that has already increased.
 * The loop yields between samples. It does not wait out a fixed delay and
 * then assert.
 */
const TIMEOUT_MS = 5_000;

export async function waitUntil<T>(
  read: () => T | Promise<T>,
  until: (value: T) => boolean,
  label = 'observable condition',
): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
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
      setTimeout(resolve, 0);
    });
  }
  throw new Error(`timed out waiting for ${label}: ${detail}`);
}
