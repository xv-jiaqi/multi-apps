import { TRPCError } from '@trpc/server';
import { APP_ERROR_CODES } from '@repo/shared';
import { retryAfterSeconds } from '../bootstrap/rate-limiters';
import { userRateLimitResponseMeta } from './user-rate-limit-headers';

function userRejection(seconds: number): TRPCError {
  return new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    cause: {
      appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
      layer: 'user',
      retryAfterSeconds: seconds,
    },
  });
}

/**
 * A 429 whose cause has no `layer` / `retryAfterSeconds`. Since CH-229 the
 * reports daily quota carries `layer: 'reportQuota'` (see reportQuotaRejection);
 * this one stands for any 429 without that cause, which must not change headers.
 */
function reportsQuota(): TRPCError {
  return new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    cause: { appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS },
  });
}

/** CH-229: the reports daily quota's 429 carries its own wait. */
function reportQuotaRejection(seconds: number): TRPCError {
  return new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    cause: {
      appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
      layer: 'reportQuota',
      retryAfterSeconds: seconds,
    },
  });
}

function responseHeaders() {
  const headers = new Map<string, string>([
    ['ratelimit', 'limit=50, remaining=48, reset=3540'],
    ['ratelimit-policy', '50;w=3600'],
    ['x-request-id', 'r-1'],
  ]);
  return {
    headers,
    res: { removeHeader: (name: string) => headers.delete(name.toLowerCase()) },
  };
}

describe('retryAfterSeconds (CH-228 228-A)', () => {
  const now = Date.UTC(2026, 10, 10, 9, 0, 0);

  it('rounds a partial second up', () => {
    expect(retryAfterSeconds({ resetTime: new Date(now + 1_001), now })).toBe(2);
    expect(retryAfterSeconds({ resetTime: new Date(now + 59_000), now })).toBe(59);
    expect(retryAfterSeconds({ resetTime: new Date(now + 3_599_999), now })).toBe(3600);
  });

  it('is at least 1 when the reset is due or already past', () => {
    expect(retryAfterSeconds({ resetTime: new Date(now + 1), now })).toBe(1);
    expect(retryAfterSeconds({ resetTime: new Date(now), now })).toBe(1);
    expect(retryAfterSeconds({ resetTime: new Date(now - 5_000), now })).toBe(1);
  });
});

describe('userRateLimitResponseMeta (CH-228 228-A/B)', () => {
  it('uses the largest wait among user-layer rejections and drops the IP quota headers', () => {
    const { headers, res } = responseHeaders();
    const meta = userRateLimitResponseMeta({
      ctx: { res },
      errors: [userRejection(40), userRejection(3000), userRejection(7)],
      eagerGeneration: false,
    });
    expect(meta).toEqual({ headers: { 'Retry-After': '3000' } });
    expect([...headers.keys()]).toEqual(['x-request-id']);
  });

  it('leaves the response alone when no call hit the user layer', () => {
    for (const errors of [[], [reportsQuota()], [new TRPCError({ code: 'FORBIDDEN' })]]) {
      const { headers, res } = responseHeaders();
      expect(userRateLimitResponseMeta({ ctx: { res }, errors, eagerGeneration: false })).toEqual(
        {},
      );
      expect(headers.size).toBe(3);
    }
  });

  it('treats the reports daily quota like the user layer and takes the largest wait (CH-229 229-B)', () => {
    const { headers, res } = responseHeaders();
    const meta = userRateLimitResponseMeta({
      ctx: { res },
      errors: [reportQuotaRejection(82_800)],
      eagerGeneration: false,
    });
    expect(meta).toEqual({ headers: { 'Retry-After': '82800' } });
    expect([...headers.keys()]).toEqual(['x-request-id']);

    for (const errors of [
      [userRejection(3600), reportQuotaRejection(30)],
      [reportQuotaRejection(30), userRejection(3600)],
    ]) {
      expect(userRateLimitResponseMeta({ errors, eagerGeneration: false })).toEqual({
        headers: { 'Retry-After': '3600' },
      });
    }
    expect(
      userRateLimitResponseMeta({
        errors: [userRejection(60), reportQuotaRejection(82_800)],
        eagerGeneration: false,
      }),
    ).toEqual({ headers: { 'Retry-After': '82800' } });
  });

  it('still sets Retry-After when the context was not built', () => {
    expect(
      userRateLimitResponseMeta({ errors: [userRejection(12)], eagerGeneration: false }),
    ).toEqual({ headers: { 'Retry-After': '12' } });
  });

  it('does not touch a streamed response whose headers go out first', () => {
    const { headers, res } = responseHeaders();
    expect(
      userRateLimitResponseMeta({
        ctx: { res },
        errors: [userRejection(5)],
        eagerGeneration: true,
      }),
    ).toEqual({});
    expect(headers.size).toBe(3);
  });
});
