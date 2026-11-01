import { seriesReleaseYearFilter } from './release-year';

describe('seriesReleaseYearFilter', () => {
  it('uses the civil year of a date-only release for Asia/Shanghai', () => {
    expect(seriesReleaseYearFilter(2024)).toEqual({
      gte: new Date('2024-01-01T00:00:00.000Z'),
      lt: new Date('2025-01-01T00:00:00.000Z'),
    });
    const june = new Date('2024-06-15T00:00:00.000Z');
    const filter = seriesReleaseYearFilter(2024);
    const gte = filter.gte;
    const lt = filter.lt;
    if (!(gte instanceof Date) || !(lt instanceof Date)) throw new Error('expected dates');
    expect(june.getTime()).toBeGreaterThanOrEqual(gte.getTime());
    expect(june.getTime()).toBeLessThan(lt.getTime());
    expect(new Date('2023-12-31T00:00:00.000Z').getTime()).toBeLessThan(gte.getTime());
    expect(new Date('2025-01-01T00:00:00.000Z').getTime()).toBeGreaterThanOrEqual(lt.getTime());
  });

  it('keeps 0000 and 9999 inside a queryable range', () => {
    const zero = seriesReleaseYearFilter(0);
    const zeroGte = zero.gte;
    const zeroLt = zero.lt;
    if (!(zeroGte instanceof Date) || !(zeroLt instanceof Date)) throw new Error('expected dates');
    expect(zeroGte.getTime()).toBeGreaterThan(zeroLt.getTime());

    const last = seriesReleaseYearFilter(9999);
    const lastGte = last.gte;
    const lastLte = last.lte;
    if (!(lastGte instanceof Date) || !(lastLte instanceof Date)) throw new Error('expected dates');
    expect(lastGte.toISOString()).toBe('9999-01-01T00:00:00.000Z');
    expect(lastLte.toISOString()).toBe('9999-12-31T00:00:00.000Z');
  });
});
