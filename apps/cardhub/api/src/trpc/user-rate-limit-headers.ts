import type { ResponseMeta } from '@trpc/server/http';
import { z } from 'zod';
import type { APP_ERROR_CODES } from '@repo/shared';

/**
 * Cause carried by a per-user TOO_MANY_REQUESTS: the user rate-limit layer
 * (TrpcBase.userRateLimit, CH-228) or the reports daily quota (CH-229).
 */
export type PerUserTooManyCause = {
  appCode: typeof APP_ERROR_CODES.TOO_MANY_REQUESTS;
  layer: 'user' | 'reportQuota';
  retryAfterSeconds: number;
};

/** The user-layer form of {@link PerUserTooManyCause}. */
export type UserRateLimitCause = PerUserTooManyCause & { layer: 'user' };

const perUserTooManyCause = z.object({
  layer: z.enum(['user', 'reportQuota']),
  retryAfterSeconds: z.number().int().min(1),
});

/** Headers the IP fallback layer (express-rate-limit, draft-7) writes before tRPC runs. */
export const IP_LAYER_QUOTA_HEADERS = ['RateLimit', 'RateLimit-Policy'] as const;

/**
 * Largest Retry-After among the calls rejected by the user layer or the
 * reports daily quota, or undefined when none was. A 429 without that cause
 * (none today) does not count.
 */
export function userRateLimitRetryAfter(
  errors: ReadonlyArray<{ cause?: unknown }>,
): number | undefined {
  let largest: number | undefined;
  for (const error of errors) {
    const parsed = perUserTooManyCause.safeParse(error.cause);
    if (!parsed.success) continue;
    largest = Math.max(largest ?? 0, parsed.data.retryAfterSeconds);
  }
  return largest;
}

type HeaderTarget = { removeHeader(name: string): void };

/**
 * tRPC `responseMeta` (CH-228 228-A/B). It runs after every call in the
 * request has settled and before tRPC writes the status line, which is after
 * the IP limiters set their headers. When the user layer or the reports
 * daily quota (CH-229) rejected a call, it removes those quota headers and
 * sets Retry-After to the largest wait. Any
 * other response, including the IP layer's own 429 (sent before tRPC), keeps
 * its headers. A streamed (jsonl) response has its headers out before the
 * calls run, so it is left as is; no Cardhub client streams.
 */
export function userRateLimitResponseMeta({
  ctx,
  errors,
  eagerGeneration,
}: {
  ctx?: { res: HeaderTarget };
  errors: ReadonlyArray<{ cause?: unknown }>;
  eagerGeneration: boolean;
}): ResponseMeta {
  if (eagerGeneration) return {};
  const seconds = userRateLimitRetryAfter(errors);
  if (seconds === undefined) return {};
  for (const name of IP_LAYER_QUOTA_HEADERS) ctx?.res.removeHeader(name);
  return { headers: { 'Retry-After': String(seconds) } };
}
