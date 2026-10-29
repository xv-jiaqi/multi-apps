import {
  catalogCacheHeaderEnabled,
  combineCacheObservations,
  createCacheHeaderReporter,
} from './cache-header';

describe('catalogCacheHeaderEnabled', () => {
  it('is on only when staging opts in with the exact string true', () => {
    expect(catalogCacheHeaderEnabled({ ENV_NAME: 'staging', CATALOG_CACHE_HEADER: 'true' })).toBe(
      true,
    );
    expect(catalogCacheHeaderEnabled({ ENV_NAME: 'prod', CATALOG_CACHE_HEADER: 'true' })).toBe(
      false,
    );
    expect(catalogCacheHeaderEnabled({ ENV_NAME: 'staging', CATALOG_CACHE_HEADER: 'TRUE' })).toBe(
      false,
    );
    expect(catalogCacheHeaderEnabled({ ENV_NAME: 'staging' })).toBe(false);
    expect(catalogCacheHeaderEnabled({})).toBe(false);
  });
});

describe('combineCacheObservations', () => {
  it('keeps a single status and lets BYPASS beat MISS and MISS beat HIT', () => {
    expect(combineCacheObservations([])).toBeUndefined();
    expect(combineCacheObservations(['HIT'])).toBe('HIT');
    expect(combineCacheObservations(['MISS'])).toBe('MISS');
    expect(combineCacheObservations(['HIT', 'MISS'])).toBe('MISS');
    expect(combineCacheObservations(['MISS', 'HIT'])).toBe('MISS');
    expect(combineCacheObservations(['HIT', 'BYPASS'])).toBe('BYPASS');
    expect(combineCacheObservations(['BYPASS', 'MISS'])).toBe('BYPASS');
  });

  it('does not replace an earlier MISS when a later procedure is a HIT', () => {
    const headers: string[] = [];
    const report = createCacheHeaderReporter((status) => {
      headers.push(status);
    });
    report('MISS');
    report('HIT');
    expect(headers).toEqual(['MISS', 'MISS']);
  });
});
