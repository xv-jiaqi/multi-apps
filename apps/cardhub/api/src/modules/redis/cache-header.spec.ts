import { catalogCacheHeaderEnabled } from './cache-header';

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
