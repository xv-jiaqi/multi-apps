import { ConfigService } from '@nestjs/config';
import { CARD_SERIES_LIST_PAGE_SIZE_DEFAULT } from '@repo/shared';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CACHE_TTL_SECONDS,
  PRODUCTION_CACHE_PREFIX,
  RedisCatalogCache,
  cacheDeletion,
  cardBySlugKey,
  categoriesListKey,
  categoryBySlugKey,
  categoryBySlugPrefix,
  cardsBySlugPrefix,
  cardsListBySeriesCacheKey,
  cardsListBySeriesPrefix,
  cardsListBySeriesSeriesPrefix,
  seriesBySlugKey,
  seriesBySlugPrefix,
  seriesListCacheKey,
  seriesListPrefix,
} from './catalog-cache';
import { CACHE_PURGE_PREFIX, RedisService } from './redis.service';

const payloadSchema = z.object({ name: z.string() });

describe('catalog cache keys', () => {
  it('uses the v1 prefix and a 5 minute TTL', () => {
    expect(PRODUCTION_CACHE_PREFIX).toBe('cardhub:cache:v1:');
    expect(CACHE_PURGE_PREFIX).toBe(PRODUCTION_CACHE_PREFIX);
    expect(CACHE_TTL_SECONDS).toBe(300);
    expect(cardBySlugKey('aurora-knight').includes('cards.bySlug:aurora-knight')).toBe(true);
    expect(cardBySlugKey('aurora-knight').startsWith(PRODUCTION_CACHE_PREFIX)).toBe(true);
  });

  it('folds the default series.list input into one key and keeps filters apart', () => {
    expect(seriesListCacheKey(undefined)).toBe(seriesListCacheKey({ page: 1, pageSize: 20 }));
    expect(
      seriesListCacheKey({
        categorySlug: 'deck-builder',
        year: 2024,
        sort: 'releaseDateDesc',
        page: 2,
        pageSize: 60,
      }),
    ).not.toBe(seriesListCacheKey(undefined));
  });

  it('names the keys an admin write must drop', () => {
    expect(
      cacheDeletion({ kind: 'card', cardSlug: 'aurora', seriesSlugs: ['dawn', 'dawn'] }),
    ).toEqual({
      keys: [cardBySlugKey('aurora'), seriesBySlugKey('dawn')],
      prefixes: [seriesListPrefix(), categoryBySlugPrefix(), cardsListBySeriesSeriesPrefix('dawn')],
    });
    expect(cacheDeletion({ kind: 'card', cardSlug: 'aurora', seriesSlugs: [] })).toEqual({
      keys: [cardBySlugKey('aurora')],
      prefixes: [seriesListPrefix(), categoryBySlugPrefix(), cardsListBySeriesPrefix()],
    });
    expect(cacheDeletion({ kind: 'series', seriesSlug: 'dawn' })).toEqual({
      keys: [seriesBySlugKey('dawn'), categoriesListKey()],
      prefixes: [
        seriesListPrefix(),
        categoryBySlugPrefix(),
        cardsBySlugPrefix(),
        cardsListBySeriesSeriesPrefix('dawn'),
      ],
    });
    expect(cacheDeletion({ kind: 'category', categorySlug: 'deck' })).toEqual({
      keys: [categoryBySlugKey('deck'), categoriesListKey()],
      prefixes: [seriesListPrefix(), seriesBySlugPrefix()],
    });
    expect(cacheDeletion({ kind: 'subset', seriesSlug: 'dawn' })).toEqual({
      keys: [seriesBySlugKey('dawn')],
      prefixes: [cardsBySlugPrefix(), cardsListBySeriesSeriesPrefix('dawn')],
    });
    expect(cacheDeletion({ kind: 'catalog' }).prefixes).toEqual([
      cardBySlugKey('x').slice(0, cardBySlugKey('x').indexOf('cards.bySlug:')),
    ]);
  });

  it('puts every listBySeries parameter in the cache key and folds defaults', () => {
    const defaults = cardsListBySeriesCacheKey({ seriesSlug: 'celestial-dawn' });
    expect(defaults).toBe(
      cardsListBySeriesCacheKey({
        seriesSlug: 'celestial-dawn',
        q: undefined,
        rarity: undefined,
        subsetSlug: undefined,
        sort: 'number',
        page: 1,
        pageSize: CARD_SERIES_LIST_PAGE_SIZE_DEFAULT,
      }),
    );
    expect(defaults.startsWith('cardhub:cache:v1:')).toBe(true);
    expect(defaults).toContain('cards.listBySeries:series=celestial-dawn&');
    expect(defaults).toContain('q=&rarity=&subset=&sort=number&page=1&pageSize=60');

    const varied = [
      { q: '龙' },
      { rarity: 'rare' },
      { subsetSlug: 'base' },
      { sort: 'name' },
      { page: 2 },
      { pageSize: 20 },
      { seriesSlug: 'other-series' },
    ];
    for (const patch of varied) {
      expect(cardsListBySeriesCacheKey({ seriesSlug: 'celestial-dawn', ...patch })).not.toBe(
        defaults,
      );
    }
    expect(cardsListBySeriesCacheKey({ seriesSlug: 'celestial-dawn', q: 'a&b' })).toContain(
      'q=a%26b',
    );
    expect(cardsListBySeriesCacheKey({ seriesSlug: 'celestial-dawn', q: 'a&b' })).not.toContain(
      'q=a&b',
    );
  });
});

describe('RedisCatalogCache', () => {
  let redis: RedisService;
  let cache: RedisCatalogCache;

  beforeAll(async () => {
    redis = new RedisService(RedisService.createClient(new ConfigService({})));
    await redis.onModuleInit();
    cache = new RedisCatalogCache(redis);
  });

  afterAll(() => {
    redis.client.disconnect();
  });

  it('skips the loader on the second read until the card key is invalidated', async () => {
    const slug = `unit-${randomUUID()}`;
    let calls = 0;
    const loader = () => {
      calls += 1;
      return Promise.resolve({ name: calls === 1 ? '旧名字' : '新名字' });
    };

    await expect(cache.read(cardBySlugKey(slug), payloadSchema, loader)).resolves.toEqual({
      name: '旧名字',
    });
    await expect(cache.read(cardBySlugKey(slug), payloadSchema, loader)).resolves.toEqual({
      name: '旧名字',
    });
    expect(calls).toBe(1);

    await cache.invalidate({ kind: 'card', cardSlug: slug, seriesSlugs: [] });

    await expect(cache.read(cardBySlugKey(slug), payloadSchema, loader)).resolves.toEqual({
      name: '新名字',
    });
    expect(calls).toBe(2);
  });
});
