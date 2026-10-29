import { AsyncLocalStorage } from 'node:async_hooks';

export type CacheObservation = 'HIT' | 'MISS' | 'BYPASS';

type ReportCacheStatus = (status: CacheObservation) => void;

const CACHE_STATUS_RANK: Record<CacheObservation, number> = {
  HIT: 0,
  MISS: 1,
  BYPASS: 2,
};

const cacheHeaderStore = new AsyncLocalStorage<ReportCacheStatus>();

/**
 * One header for a whole HTTP request. Batch procedures run together, so the
 * value is not "whichever finished last": BYPASS wins, then MISS, then HIT.
 */
export function combineCacheObservations(
  statuses: readonly CacheObservation[],
): CacheObservation | undefined {
  let best: CacheObservation | undefined;
  for (const status of statuses) {
    if (best === undefined || CACHE_STATUS_RANK[status] > CACHE_STATUS_RANK[best]) {
      best = status;
    }
  }
  return best;
}

export function createCacheHeaderReporter(
  setHeader: (value: CacheObservation) => void,
): ReportCacheStatus {
  const seen: CacheObservation[] = [];
  return (status) => {
    seen.push(status);
    const combined = combineCacheObservations(seen);
    if (combined !== undefined) setHeader(combined);
  };
}

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
