import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  DAILY_ACTIVITY_KEY_PREFIX,
  recordDailyActivity,
  secondsUntilNextUtcMidnight,
  type DailyActivityRedis,
} from './daily-activity';

function store(createMany: jest.Mock): PrismaService {
  return { userDailyActivity: { createMany } } as unknown as PrismaService;
}

describe('recordDailyActivity', () => {
  const now = new Date('2001-04-02T23:30:00.000Z');

  it('writes on every call when Redis is unavailable', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    await recordDailyActivity(store(createMany), 'user-1', { now });
    await recordDailyActivity(store(createMany), 'user-1', { now });

    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenNthCalledWith(1, {
      data: [{ userId: 'user-1', day: new Date('2001-04-02T00:00:00.000Z') }],
      skipDuplicates: true,
    });
    expect(createMany).toHaveBeenNthCalledWith(2, {
      data: [{ userId: 'user-1', day: new Date('2001-04-02T00:00:00.000Z') }],
      skipDuplicates: true,
    });
  });

  it('writes the database once per user per UTC day when Redis accepts the lock', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const set = jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const redis: DailyActivityRedis = { set };
    await recordDailyActivity(store(createMany), 'user-1', { now, redis });
    await recordDailyActivity(store(createMany), 'user-1', { now, redis });

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenNthCalledWith(
      1,
      `${DAILY_ACTIVITY_KEY_PREFIX}user-1:2001-04-02`,
      '1',
      'EX',
      30 * 60,
      'NX',
    );
    expect(set).toHaveBeenNthCalledWith(
      2,
      `${DAILY_ACTIVITY_KEY_PREFIX}user-1:2001-04-02`,
      '1',
      'EX',
      30 * 60,
      'NX',
    );
  });

  it('writes the database when the Redis lock command fails', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const redis: DailyActivityRedis = {
      set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    await recordDailyActivity(store(createMany), 'user-1', { now, redis });
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('sets the lock to expire at the next UTC midnight', () => {
    expect(secondsUntilNextUtcMidnight(new Date('2001-04-02T23:30:00.000Z'))).toBe(30 * 60);
    expect(secondsUntilNextUtcMidnight(new Date('2001-04-02T23:59:59.200Z'))).toBe(1);
    expect(secondsUntilNextUtcMidnight(new Date('2001-04-03T00:00:00.000Z'))).toBe(24 * 60 * 60);
  });

  it('uses the next UTC date after midnight', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    await recordDailyActivity(store(createMany), 'user-1', {
      now: new Date('2001-04-02T00:00:00.000Z'),
    });
    expect(createMany.mock.calls[0][0].data[0].day.toISOString()).toBe('2001-04-02T00:00:00.000Z');
  });

  it('swallows a write failure and does not include the user id in the warning', async () => {
    const warn = jest.fn();
    const error = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const createMany = jest.fn().mockRejectedValue(error);

    await expect(
      recordDailyActivity(store(createMany), 'user-secret', { now, warn }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith('P2002');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('user-secret');
  });

  it('still resolves when the warning callback throws', async () => {
    const createMany = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(
      recordDailyActivity(store(createMany), 'user-1', {
        now,
        warn: () => {
          throw new Error('logger down');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
