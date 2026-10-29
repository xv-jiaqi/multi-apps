import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { InvalidAuthTokenError, type AuthService } from '../modules/auth/auth.service';
import type { DailyActivityRedis } from '../modules/metrics/daily-activity';
import type { PrismaService } from '../modules/prisma/prisma.service';
import { makeCreateContext } from './context';

const userRow = { tokenVersion: 0, role: 'user', bannedAt: null };

function harness(options?: {
  createMany?: jest.Mock;
  findUnique?: jest.Mock;
  verify?: jest.Mock;
  redis?: DailyActivityRedis;
}) {
  const createMany = options?.createMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const findUnique = options?.findUnique ?? jest.fn().mockResolvedValue(userRow);
  const verify =
    options?.verify ?? jest.fn().mockReturnValue({ sub: 'user-1', username: 'ada', ver: 0 });
  const prisma = {
    user: { findUnique },
    userDailyActivity: { createMany },
  } as unknown as PrismaService;
  const auth = { verify } as unknown as AuthService;
  const warn = jest.fn();
  const createContext = makeCreateContext(auth, prisma, options?.redis);
  const call = (authorization?: string) =>
    createContext({
      req: { headers: authorization ? { authorization } : {}, log: { warn } },
      res: {},
    } as unknown as CreateExpressContextOptions);

  return { createMany, findUnique, verify, warn, call };
}

describe('makeCreateContext daily activity', () => {
  it('records the UTC day for a verified user and still returns that user', async () => {
    const { createMany, call } = harness();
    const ctx = await call('Bearer token');
    expect(ctx.user).toEqual({
      sub: 'user-1',
      username: 'ada',
      role: 'user',
      tokenVersion: 0,
      bannedAt: null,
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', day: expect.any(Date) }],
      skipDuplicates: true,
    });
  });

  it('writes the activity row once when the same user is seen twice in one UTC day', async () => {
    const set = jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const { createMany, call } = harness({ redis: { set } });
    expect((await call('Bearer token')).user?.sub).toBe('user-1');
    expect((await call('Bearer token')).user?.sub).toBe('user-1');
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('returns the user when the activity write fails', async () => {
    const { call, warn } = harness({
      createMany: jest.fn().mockRejectedValue(new Error('db down')),
    });
    const ctx = await call('Bearer token');
    expect(ctx.user?.sub).toBe('user-1');
    expect(warn).toHaveBeenCalledWith({ errCode: 'unknown' }, 'daily activity write failed');
  });

  it('does not record activity without a token, with a bad token, or when the session row is gone', async () => {
    const anonymous = harness();
    expect((await anonymous.call()).user).toBeNull();
    expect(anonymous.createMany).not.toHaveBeenCalled();

    const invalid = harness({
      verify: jest.fn().mockImplementation(() => {
        throw new InvalidAuthTokenError();
      }),
    });
    expect((await invalid.call('Bearer nope')).user).toBeNull();
    expect(invalid.createMany).not.toHaveBeenCalled();

    const missing = harness({ findUnique: jest.fn().mockResolvedValue(null) });
    expect((await missing.call('Bearer token')).user).toBeNull();
    expect(missing.createMany).not.toHaveBeenCalled();
  });
});
