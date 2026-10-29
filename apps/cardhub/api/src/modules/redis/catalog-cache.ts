import { Injectable } from '@nestjs/common';
import type { ZodType } from 'zod';
import { RedisService } from './redis.service';

/** Public catalog entries. Do not put per-user fields (CH-203 collection) in these keys. */
export const PRODUCTION_CACHE_PREFIX = 'cardhub:cache:v1:';
export const CACHE_TTL_SECONDS = 300;

let resolvedPrefix: string | undefined;

export function cacheKeyPrefix(): string {
  if (resolvedPrefix === undefined) {
    const worker = process.env.JEST_WORKER_ID ?? String(process.pid);
    resolvedPrefix =
      process.env.NODE_ENV === 'test'
        ? `${PRODUCTION_CACHE_PREFIX}test:${worker}:`
        : PRODUCTION_CACHE_PREFIX;
  }
  return resolvedPrefix;
}

export function cardBySlugKey(slug: string): string {
  return `${cacheKeyPrefix()}cards.bySlug:${slug}`;
}

export function seriesBySlugKey(slug: string): string {
  return `${cacheKeyPrefix()}series.bySlug:${slug}`;
}

export function seriesListPrefix(): string {
  return `${cacheKeyPrefix()}series.list:`;
}

export function seriesBySlugPrefix(): string {
  return `${cacheKeyPrefix()}series.bySlug:`;
}

export function categoryBySlugKey(slug: string): string {
  return `${cacheKeyPrefix()}categories.bySlug:${slug}`;
}

export function categoryBySlugPrefix(): string {
  return `${cacheKeyPrefix()}categories.bySlug:`;
}

export function categoriesListKey(): string {
  return `${cacheKeyPrefix()}categories.list`;
}

export function cardsBySlugPrefix(): string {
  return `${cacheKeyPrefix()}cards.bySlug:`;
}

export function seriesListCacheKey(
  input:
    | {
        page?: number;
        pageSize?: number;
        categorySlug?: string;
        year?: number;
        sort?: string;
      }
    | undefined,
): string {
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 20;
  const category = input?.categorySlug ?? '';
  const year = input?.year === undefined ? '' : String(input.year);
  const sort = input?.sort ?? '';
  return `${seriesListPrefix()}page=${page}&pageSize=${pageSize}&category=${category}&year=${year}&sort=${sort}`;
}

export type CatalogChange =
  | { kind: 'card'; cardSlug: string; seriesSlugs: readonly string[] }
  | { kind: 'series'; seriesSlug: string }
  | { kind: 'category'; categorySlug: string }
  | { kind: 'subset'; seriesSlug: string }
  | { kind: 'catalog' };

export type CacheDeletion = {
  keys: string[];
  prefixes: string[];
};

function uniqueSlugs(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    slugs.push(value);
  }
  return slugs;
}

export function cacheDeletion(change: CatalogChange): CacheDeletion {
  switch (change.kind) {
    case 'card':
      return {
        keys: [
          cardBySlugKey(change.cardSlug),
          ...uniqueSlugs(change.seriesSlugs).map(seriesBySlugKey),
        ],
        prefixes: [seriesListPrefix(), categoryBySlugPrefix()],
      };
    case 'series':
      return {
        keys: [seriesBySlugKey(change.seriesSlug), categoriesListKey()],
        prefixes: [seriesListPrefix(), categoryBySlugPrefix(), cardsBySlugPrefix()],
      };
    case 'category':
      return {
        keys: [categoryBySlugKey(change.categorySlug), categoriesListKey()],
        prefixes: [seriesListPrefix(), seriesBySlugPrefix()],
      };
    case 'subset':
      return {
        keys: [seriesBySlugKey(change.seriesSlug)],
        prefixes: [cardsBySlugPrefix()],
      };
    case 'catalog':
      return { keys: [], prefixes: [cacheKeyPrefix()] };
  }
}

export abstract class CatalogCache {
  abstract read<T>(key: string, schema: ZodType<T>, loader: () => Promise<T>): Promise<T>;
  abstract invalidate(change: CatalogChange): Promise<void>;
}

@Injectable()
export class RedisCatalogCache extends CatalogCache {
  constructor(private readonly redis: RedisService) {
    super();
  }

  override read<T>(key: string, schema: ZodType<T>, loader: () => Promise<T>): Promise<T> {
    return this.redis.getOrSet(key, CACHE_TTL_SECONDS, schema, loader);
  }

  override async invalidate(change: CatalogChange): Promise<void> {
    const plan = cacheDeletion(change);
    await this.redis.deleteKeys(plan.keys);
    for (const prefix of plan.prefixes) {
      await this.redis.deleteByPrefix(prefix);
    }
  }
}

/** Used by router unit tests that construct routers outside Nest. */
export class DirectCatalogCache extends CatalogCache {
  override read<T>(_key: string, _schema: ZodType<T>, loader: () => Promise<T>): Promise<T> {
    return loader();
  }

  override async invalidate(_change: CatalogChange): Promise<void> {}
}
