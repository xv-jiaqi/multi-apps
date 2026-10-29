import { ratioTo4 } from './product-metrics';

describe('ratioTo4', () => {
  it('returns null for an empty cohort and rounds half away from zero', () => {
    expect(ratioTo4(1, 0)).toBeNull();
    expect(ratioTo4(0, 4)).toBe(0);
    expect(ratioTo4(1, 2)).toBe(0.5);
    expect(ratioTo4(1, 3)).toBe(0.3333);
    expect(ratioTo4(2, 3)).toBe(0.6667);
    expect(ratioTo4(10, 30)).toBe(0.3333);
    expect(ratioTo4(5, 17)).toBe(0.2941);
  });
});
