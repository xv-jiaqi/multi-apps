import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { recordDailyActivity } from './daily-activity';

function store(createMany: jest.Mock): PrismaService {
  return { userDailyActivity: { createMany } } as unknown as PrismaService;
}

describe('recordDailyActivity', () => {
  const now = new Date('2001-04-02T23:30:00.000Z');

  it('writes one row for the UTC day and ignores duplicates in the database', async () => {
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
