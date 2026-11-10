import type { Prisma } from '@prisma/client';
import { APP_ERROR_CODES } from '@repo/shared';
import { retryAfterSeconds } from '../../bootstrap/rate-limiters';
import type { PerUserTooManyCause } from '../../trpc/user-rate-limit-headers';

/** Reports one account may file in any rolling window (counted in the database). */
export const REPORT_DAILY_LIMIT = 10;

/** The window is a rolling 24 hours, not a calendar day. */
export const REPORT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * CH-229 229-A: seconds until the oldest report inside the window turns 24h
 * old and drops out, rounded up, at least 1. A report exactly 24h old still
 * counts (`createdAt >= since`), so that case is 1.
 */
export function reportQuotaRetryAfterSeconds({
  oldestCreatedAt,
  now,
}: {
  oldestCreatedAt: Date;
  now: number;
}): number {
  return retryAfterSeconds({
    resetTime: new Date(oldestCreatedAt.getTime() + REPORT_QUOTA_WINDOW_MS),
    now,
  });
}

/** Cause of the quota's 429; userRateLimitResponseMeta turns it into headers. */
export function reportQuotaCause({
  retryAfterSeconds,
}: {
  retryAfterSeconds: number;
}): PerUserTooManyCause {
  return { appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS, layer: 'reportQuota', retryAfterSeconds };
}

/**
 * First key of the two-int advisory lock that serializes one account's quota
 * check and insert (CH-230 230-A). A fixed namespace keeps these locks apart
 * from any other advisory lock (Prisma migrate uses a single bigint key,
 * which Postgres keeps in a separate key space from two-int keys).
 */
export const REPORT_QUOTA_LOCK_NAMESPACE = 230;

/**
 * Takes the per-account quota lock for the rest of the transaction. Only
 * the same reporterId waits; it is released on commit or rollback.
 * The second key is `hashtext(reporterId)` (int4). Two accounts whose ids
 * hash to the same value would also wait on each other. That only adds a
 * short wait to an occasional unrelated report and never lets one through.
 */
export async function lockReportQuota(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  reporterId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REPORT_QUOTA_LOCK_NAMESPACE}::int4, hashtext(${reporterId}))`;
}
