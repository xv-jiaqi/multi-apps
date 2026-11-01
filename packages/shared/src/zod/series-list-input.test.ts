import { describe, expect, it } from 'vitest';
import { seriesListInput } from './index';

describe('seriesListInput releasedOnOrBefore', () => {
  it('accepts an omitted cutoff and a real calendar day', () => {
    expect(seriesListInput.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(seriesListInput.parse({ releasedOnOrBefore: '2024-06-01' }).releasedOnOrBefore).toBe(
      '2024-06-01',
    );
  });

  it('rejects impossible and non-ISO dates', () => {
    for (const releasedOnOrBefore of ['2024-02-31', '2024-13-01', '03/15/2024', '']) {
      const parsed = seriesListInput.safeParse({ releasedOnOrBefore });
      expect(parsed.success).toBe(false);
      if (parsed.success) continue;
      expect(parsed.error.issues.some((issue) => issue.message === 'invalid_date')).toBe(true);
    }
  });
});
