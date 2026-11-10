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
