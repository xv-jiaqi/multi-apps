import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

type TimingStore = {
  dbNs: bigint;
  cacheNs: bigint;
};

const timings = new AsyncLocalStorage<TimingStore>();

/** Milliseconds spent in Prisma queries for the current request. */
export function addDbDurationMs(milliseconds: number): void {
  const store = timings.getStore();
  if (!store || !Number.isFinite(milliseconds) || milliseconds < 0) return;
  store.dbNs += BigInt(Math.round(milliseconds * 1_000_000));
}

/**
 * Time a catalog-cache round trip. The callback's own result is not read.
 * Names, keys, and payloads never enter the Server-Timing header.
 */
export async function timeCache<T>(work: () => Promise<T>): Promise<T> {
  const store = timings.getStore();
  if (!store) return work();
  const started = process.hrtime.bigint();
  try {
    return await work();
  } finally {
    store.cacheNs += process.hrtime.bigint() - started;
  }
}

function formatDuration(nanoseconds: bigint): string {
  const milliseconds = Number(nanoseconds) / 1_000_000;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '0.0';
  return (Math.round(milliseconds * 10) / 10).toFixed(1);
}

export function formatServerTiming(appNs: bigint, dbNs: bigint, cacheNs: bigint): string {
  return `app;dur=${formatDuration(appNs)}, db;dur=${formatDuration(dbNs)}, cache;dur=${formatDuration(cacheNs)}`;
}

function installBeforeHeaders(res: Response, writeTiming: () => void): void {
  let written = false;
  const writeOnce = () => {
    if (written || res.headersSent) return;
    written = true;
    writeTiming();
  };

  const end = res.end;
  res.end = function serverTimingEnd(this: Response, ...args: unknown[]) {
    writeOnce();
    return end.apply(this, args as Parameters<Response['end']>);
  } as Response['end'];

  const writeHead = res.writeHead;
  res.writeHead = function serverTimingWriteHead(this: Response, ...args: unknown[]) {
    writeOnce();
    return writeHead.apply(this, args as Parameters<Response['writeHead']>);
  } as Response['writeHead'];
}

/**
 * Records total time plus database and catalog-cache time.
 * `Timing-Allow-Origin` echoes one allowlisted Origin. It is never `*`.
 */
export function serverTiming(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction) => {
    const store: TimingStore = { dbNs: 0n, cacheNs: 0n };
    const started = process.hrtime.bigint();
    installBeforeHeaders(res, () => {
      const origin = req.headers.origin;
      if (typeof origin === 'string' && allowed.has(origin)) {
        res.setHeader('Timing-Allow-Origin', origin);
      }
      res.setHeader(
        'Server-Timing',
        formatServerTiming(process.hrtime.bigint() - started, store.dbNs, store.cacheNs),
      );
    });
    timings.run(store, () => {
      next();
    });
  };
}
