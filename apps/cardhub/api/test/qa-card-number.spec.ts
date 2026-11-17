import { CARD_NUMBER_MAX } from '@repo/shared';
import { qaCardNumber } from './qa-card-number';

describe('qaCardNumber', () => {
  it('returns a qa- prefixed value uniquely and within the card-number limit', () => {
    const values = new Set(Array.from({ length: 20 }, () => qaCardNumber()));
    expect(values.size).toBe(20);
    for (const value of values) {
      expect(value.startsWith('qa-')).toBe(true);
      expect(value).toHaveLength('qa-'.length + 12);
      expect(value.length).toBeLessThanOrEqual(CARD_NUMBER_MAX);
      expect(value).toMatch(/^qa-[0-9a-f]+$/);
    }
  });
});
