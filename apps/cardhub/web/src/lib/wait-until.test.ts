import { describe, expect, it } from 'vitest';
import { waitUntil } from '@cardhub/test-utils';

describe('waitUntil', () => {
  it('keeps the previous timeout and interval when those options are omitted', async () => {
    let reads = 0;
    const started = Date.now();
    const value = await waitUntil(
      () => {
        reads += 1;
        return reads;
      },
      (sample) => sample >= 2,
    );
    expect(value).toBe(2);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('uses the given interval and timeout', async () => {
    const started = Date.now();
    await expect(
      waitUntil(
        () => false,
        (sample) => sample === true,
        'never',
        {
          interval: 5,
          timeout: 30,
        },
      ),
    ).rejects.toThrow('timed out waiting for never');
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(500);
  });
});
