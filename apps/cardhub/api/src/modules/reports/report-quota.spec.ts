import { APP_ERROR_CODES } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import type { TrpcContext } from '../../trpc/context';
import type { PrismaService } from '../prisma/prisma.service';
import { REPORT_QUOTA_WINDOW_MS, reportQuotaRetryAfterSeconds } from './report-quota';
import { ReportsRouter } from './reports.router';

const NOW = Date.UTC(2026, 10, 10, 11, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe('reportQuotaRetryAfterSeconds (CH-229 229-A)', () => {
  it('is the time until the oldest report in the window turns 24h old, rounded up', () => {
    expect(
      reportQuotaRetryAfterSeconds({ oldestCreatedAt: new Date(NOW - 60 * 60_000), now: NOW }),
    ).toBe(23 * 60 * 60);
    expect(
      reportQuotaRetryAfterSeconds({ oldestCreatedAt: new Date(NOW - DAY + 1_001), now: NOW }),
    ).toBe(2);
  });

  it('is 1 when less than a second is left', () => {
    expect(
      reportQuotaRetryAfterSeconds({ oldestCreatedAt: new Date(NOW - DAY + 1), now: NOW }),
    ).toBe(1);
    expect(
      reportQuotaRetryAfterSeconds({ oldestCreatedAt: new Date(NOW - DAY + 999), now: NOW }),
    ).toBe(1);
  });

  it('is 1 when the oldest report is exactly 24h old (it is still inside the window)', () => {
    expect(reportQuotaRetryAfterSeconds({ oldestCreatedAt: new Date(NOW - DAY), now: NOW })).toBe(
      1,
    );
  });

  it('uses a 24h window', () => {
    expect(REPORT_QUOTA_WINDOW_MS).toBe(DAY);
  });
});

describe('reports.create quota with an injected clock (CH-229 229-A)', () => {
  const user: NonNullable<TrpcContext['user']> = {
    sub: 'u1',
    username: 'alice',
    role: 'user',
    tokenVersion: 0,
    bannedAt: null,
  };
  const input = {
    targetType: 'COMMENT' as const,
    targetId: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
    reason: 'still spam',
  };

  function overQuota(oldest: Date | null) {
    const count = jest.fn().mockResolvedValue(10);
    const findFirst = jest.fn().mockResolvedValue(oldest ? { createdAt: oldest } : null);
    const create = jest.fn();
    const prisma = { report: { count, findFirst, create } } as unknown as PrismaService;
    const built = new ReportsRouter(new TrpcBase(), prisma).build({ now: () => NOW });
    const caller = built.createCaller({
      req: {} as never,
      res: {} as never,
      user,
      userRateLimit: { hit: async () => ({ limited: false, totalHits: 1, limit: 20 }) },
    });
    return { caller, count, findFirst, create };
  }

  it.each([
    ['exactly 24h old', NOW - DAY, 1],
    ['less than a second from leaving the window', NOW - DAY + 400, 1],
    ['one hour old', NOW - 60 * 60_000, 23 * 60 * 60],
  ])('oldest report %s → retryAfterSeconds %i on the cause', async (_label, oldest, expected) => {
    const { caller, count, findFirst, create } = overQuota(new Date(oldest));
    await expect(caller.create(input)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: '今日举报次数已达上限，请明天再试',
      cause: {
        appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
        layer: 'reportQuota',
        retryAfterSeconds: expected,
      },
    });
    const since = new Date(NOW - DAY);
    expect(count).toHaveBeenCalledWith({
      where: { reporterId: 'u1', createdAt: { gte: since } },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reporterId: 'u1', createdAt: { gte: since } } }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('waits a full window when the oldest report is gone by the time it is read', async () => {
    const { caller } = overQuota(null);
    await expect(caller.create(input)).rejects.toMatchObject({
      cause: { layer: 'reportQuota', retryAfterSeconds: DAY / 1000 },
    });
  });
});
