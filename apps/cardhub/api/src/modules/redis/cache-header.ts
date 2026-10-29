import { AsyncLocalStorage } from 'node:async_hooks';

export type CacheObservation = 'HIT' | 'MISS' | 'BYPASS';

type ReportCacheStatus = (status: CacheObservation) => void;

const cacheHeaderStore = new AsyncLocalStorage<ReportCacheStatus>();

/** Staging opt-in. Production stays off unless both values are set this way. */
export function catalogCacheHeaderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENV_NAME === 'staging' && env.CATALOG_CACHE_HEADER === 'true';
}

export function observeCacheHeader<T>(report: ReportCacheStatus, fn: () => T): T {
  return cacheHeaderStore.run(report, fn);
}

export function reportCacheStatus(status: CacheObservation): void {
  if (!catalogCacheHeaderEnabled()) return;
  const report = cacheHeaderStore.getStore();
  if (report) report(status);
}
