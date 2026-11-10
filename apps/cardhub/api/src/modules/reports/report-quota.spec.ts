import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { APP_ERROR_CODES } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import type { TrpcContext } from '../../trpc/context';
import type { PrismaService } from '../prisma/prisma.service';
import {
  isReportQuotaLockTimeout,
  REPORT_QUOTA_WINDOW_MS,
  reportQuotaRetryAfterSeconds,
} from './report-quota';
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
    const tx = {
      report: { count, findFirst, create },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const prisma = {
      ...tx,
      // CH-230: the quota check runs inside an interactive transaction.
      $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx),
    } as unknown as PrismaService;
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
  ])(
    'oldest report %s (createdAt %i) → retryAfterSeconds %i on the cause',
    async (_label, oldest, expected) => {
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
    },
  );

  it('waits a full window when the oldest report is gone by the time it is read', async () => {
    const { caller } = overQuota(null);
    await expect(caller.create(input)).rejects.toMatchObject({
      cause: { layer: 'reportQuota', retryAfterSeconds: DAY / 1000 },
    });
  });
});

describe('reports quota lock timeout (CH-231 231-B)', () => {
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

  /** The shape Prisma 6.19 gives a Postgres error raised by a raw query (measured, CH-231). */
  function rawQueryError(sqlState: string, message: string) {
    return new Prisma.PrismaClientKnownRequestError(
      `Raw query failed. Code: \`${sqlState}\`. Message: \`${message}\``,
      { code: 'P2010', clientVersion: '6.19.3', meta: { code: sqlState, message } },
    );
  }

  function failingTransaction(error: unknown) {
    const create = jest.fn();
    const prisma = {
      report: { create },
      $transaction: async () => {
        throw error;
      },
    } as unknown as PrismaService;
    const built = new ReportsRouter(new TrpcBase(), prisma).build({ now: () => NOW });
    const caller = built.createCaller({
      req: {} as never,
      res: {} as never,
      user,
      userRateLimit: { hit: async () => ({ limited: false, totalHits: 1, limit: 20 }) },
    });
    return { caller, create };
  }

  it('matches only P2010 whose Postgres code is 55P03', () => {
    expect(
      isReportQuotaLockTimeout(
        rawQueryError('55P03', 'ERROR: canceling statement due to lock timeout'),
      ),
    ).toBe(true);
    expect(isReportQuotaLockTimeout(rawQueryError('40P01', 'ERROR: deadlock detected'))).toBe(
      false,
    );
    expect(
      isReportQuotaLockTimeout(
        rawQueryError('57014', 'ERROR: canceling statement due to statement timeout'),
      ),
    ).toBe(false);
    expect(
      isReportQuotaLockTimeout(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.19.3',
          meta: { code: '55P03' },
        }),
      ),
    ).toBe(false);
    expect(isReportQuotaLockTimeout(new Error('55P03'))).toBe(false);
    expect(isReportQuotaLockTimeout({ code: '55P03' })).toBe(false);
    expect(isReportQuotaLockTimeout(undefined)).toBe(false);
  });

  it('turns a lock timeout into a 429 that asks to retry in 1 second and writes nothing', async () => {
    const { caller, create } = failingTransaction(
      rawQueryError('55P03', 'ERROR: canceling statement due to lock timeout'),
    );
    await expect(caller.create(input)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: '操作太频繁，请稍后再试',
      cause: {
        appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
        layer: 'reportQuota',
        retryAfterSeconds: 1,
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('does not turn a 55P03 from a model query after the lock into a 429 (CH-232)', async () => {
    // A model query (report.create) that hits a lock timeout surfaces as an
    // unknown request error, not P2010; it stays a 500.
    const afterLock = new Prisma.PrismaClientUnknownRequestError(
      'Error occurred during query execution: ConnectorError(... code: "55P03", message: "canceling statement due to lock timeout" ...)',
      { clientVersion: '6.19.3' },
    );
    expect(isReportQuotaLockTimeout(afterLock)).toBe(false);
    const { caller } = failingTransaction(afterLock);
    const error = await caller.create(input).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', cause: afterLock });
  });

  it('passes any other database error through unchanged', async () => {
    const deadlock = rawQueryError('40P01', 'ERROR: deadlock detected');
    const { caller } = failingTransaction(deadlock);
    const error = await caller.create(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', cause: deadlock });
  });
});
