import { TRPCError } from '@trpc/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { APP_ERROR_CODES } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import type { TrpcContext } from '../../trpc/context';
import { AuthRouter } from './auth.router';
import type { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';

const TEST_PASSWORD = randomUUID();
const INCORRECT_PASSWORD = randomUUID();

/**
 * AuthRouter unit tests. We mock PrismaService and AuthService so the
 * router logic (conflict detection, password hashing roundtrip, error
 * mapping) is exercised without spinning up a database. Integration tests
 * that walk through real HTTP + Prisma live in test/auth.e2e-spec.ts.
 */

type MockPrismaUser = {
  findFirst: jest.Mock;
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
};

function makeRouter(user: TrpcContext['user'] = null, prehashWrite = false) {
  const userMock: MockPrismaUser = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = { user: userMock } as unknown as PrismaService;

  const auth = {
    sign: jest.fn().mockReturnValue('signed.jwt.token'),
    verify: jest.fn(),
  } as unknown as AuthService;

  const previous = process.env.PASSWORD_PREHASH_WRITE;
  process.env.PASSWORD_PREHASH_WRITE = prehashWrite ? 'true' : 'false';
  const router = new AuthRouter(new TrpcBase(), prisma, auth);
  const caller = router.build().createCaller({
    req: {} as never,
    res: {} as never,
    user,
  });
  if (previous === undefined) {
    delete process.env.PASSWORD_PREHASH_WRITE;
  } else {
    process.env.PASSWORD_PREHASH_WRITE = previous;
  }

  return { caller, userMock, auth };
}

const signedInUser = {
  sub: 'u1',
  username: 'alice',
  role: 'user',
  tokenVersion: 0,
};

describe('AuthRouter.register', () => {
  it('rejects an email longer than 128 characters', async () => {
    const { caller, userMock } = makeRouter();

    await expect(
      caller.register({
        email: `${'a'.repeat(117)}@example.com`,
        username: 'alice',
        password: TEST_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(userMock.findFirst).not.toHaveBeenCalled();
  });

  it('rejects duplicate email with CONFLICT', async () => {
    const { caller, userMock } = makeRouter();
    userMock.findFirst.mockResolvedValueOnce({
      id: 'u1',
      email: 'alice@cardhub.test',
      username: 'someoneElse',
    });

    await expect(
      caller.register({
        email: 'alice@cardhub.test',
        username: 'alice',
        password: TEST_PASSWORD,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '该邮箱已被注册',
    });
  });

  it('rejects duplicate username with CONFLICT', async () => {
    const { caller, userMock } = makeRouter();
    userMock.findFirst.mockResolvedValueOnce({
      id: 'u1',
      email: 'other@cardhub.test',
      username: 'alice',
    });

    await expect(
      caller.register({
        email: 'alice@cardhub.test',
        username: 'alice',
        password: TEST_PASSWORD,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '该用户名已被占用',
    });
  });

  it('creates user, hashes password and returns a signed token', async () => {
    const { caller, userMock, auth } = makeRouter();
    userMock.findFirst.mockResolvedValueOnce(null);
    userMock.create.mockImplementationOnce(({ data }) =>
      Promise.resolve({
        id: 'u-new',
        email: data.email,
        username: data.username,
        role: 'user',
        tokenVersion: 0,
      }),
    );

    const result = await caller.register({
      email: 'alice@cardhub.test',
      username: 'alice',
      password: TEST_PASSWORD,
    });

    expect(result.token).toBe('signed.jwt.token');
    expect(result.user).toEqual({
      id: 'u-new',
      email: 'alice@cardhub.test',
      username: 'alice',
      role: 'user',
    });

    const createCall = userMock.create.mock.calls[0]?.[0];
    expect(createCall.data.password).not.toBe(TEST_PASSWORD);
    expect(createCall.data.password.startsWith('$2')).toBe(true);
    expect(auth.sign).toHaveBeenCalledWith({ sub: 'u-new', username: 'alice', ver: 0 });
  });

  it('stores a pre-hashed password when writes are enabled', async () => {
    const { caller, userMock } = makeRouter(null, true);
    userMock.findFirst.mockResolvedValueOnce(null);
    userMock.create.mockImplementationOnce(({ data }) =>
      Promise.resolve({
        id: 'u-new',
        email: data.email,
        username: data.username,
        role: 'user',
        tokenVersion: 0,
      }),
    );

    await caller.register({
      email: 'alice@cardhub.test',
      username: 'alice',
      password: TEST_PASSWORD,
    });

    const createCall = userMock.create.mock.calls[0]?.[0];
    expect(createCall.data.password.startsWith('sha256$')).toBe(true);
  });
});

describe('AuthRouter.login', () => {
  it('rejects unknown identifier with UNAUTHORIZED', async () => {
    const { caller, userMock } = makeRouter();
    userMock.findFirst.mockResolvedValueOnce(null);

    await expect(
      caller.login({ identifier: 'nobody', password: TEST_PASSWORD }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('rejects wrong password with UNAUTHORIZED', async () => {
    const { caller, userMock } = makeRouter();
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 4);
    userMock.findFirst.mockResolvedValueOnce({
      id: 'u1',
      email: 'alice@cardhub.test',
      username: 'alice',
      password: hashedPassword,
      role: 'admin',
      tokenVersion: 0,
    });

    await expect(
      caller.login({ identifier: 'alice', password: INCORRECT_PASSWORD }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns token + user on valid credentials', async () => {
    const { caller, userMock, auth } = makeRouter();
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 4);
    userMock.findFirst.mockResolvedValueOnce({
      id: 'u1',
      email: 'alice@cardhub.test',
      username: 'alice',
      password: hashedPassword,
      role: 'admin',
      tokenVersion: 4,
    });

    const result = await caller.login({
      identifier: 'alice',
      password: TEST_PASSWORD,
    });

    expect(result.token).toBe('signed.jwt.token');
    expect(result.user).toEqual({
      id: 'u1',
      email: 'alice@cardhub.test',
      username: 'alice',
      role: 'admin',
      passwordChangeRecommended: false,
      bannedAt: null,
    });
    expect(auth.sign).toHaveBeenCalledWith({ sub: 'u1', username: 'alice', ver: 4 });
    expect(userMock.update).not.toHaveBeenCalled();
    expect(userMock.updateMany).not.toHaveBeenCalled();
  });

  it('upgrades a legacy hash when prehash writes are enabled', async () => {
    const { caller, userMock } = makeRouter(null, true);
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 4);
    userMock.findFirst.mockResolvedValueOnce({
      id: 'u1',
      email: 'alice@cardhub.test',
      username: 'alice',
      password: hashedPassword,
      role: 'admin',
      tokenVersion: 4,
    });

    await caller.login({ identifier: 'alice', password: TEST_PASSWORD });

    expect(userMock.update).not.toHaveBeenCalled();
    const update = userMock.updateMany.mock.calls[0]?.[0];
    expect(update.where).toEqual({ id: 'u1', password: hashedPassword });
    expect(update.data.password.startsWith('sha256$')).toBe(true);
    expect(update.data.tokenVersion).toBeUndefined();
  });

  it('treats identifier with @ as email lookup', async () => {
    const { caller, userMock } = makeRouter();
    userMock.findFirst.mockResolvedValueOnce(null);

    await expect(
      caller.login({ identifier: 'alice@cardhub.test', password: TEST_PASSWORD }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const where = userMock.findFirst.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({ email: 'alice@cardhub.test' });
  });
});

describe('AuthRouter.me', () => {
  const currentUser = {
    sub: 'u-admin',
    username: 'admin',
    role: 'admin',
    tokenVersion: 0,
  };

  it('rejects anonymous callers before reading the optional input', async () => {
    const { caller, auth, userMock } = makeRouter();

    await expect(caller.me({ token: 'a'.repeat(2049) })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    expect(auth.verify).not.toHaveBeenCalled();
    expect(userMock.findUnique).not.toHaveBeenCalled();
  });

  it('returns ctx.user and ignores the input token', async () => {
    const { caller, userMock, auth } = makeRouter(currentUser);
    userMock.findUnique.mockResolvedValue({
      id: 'u-admin',
      email: 'admin@cardhub.test',
      username: 'admin',
      role: 'admin',
      passwordChangeRecommended: false,
    });

    await expect(caller.me({ token: 'ignored.jwt.token' })).resolves.toEqual({
      id: 'u-admin',
      email: 'admin@cardhub.test',
      username: 'admin',
      role: 'admin',
      passwordChangeRecommended: false,
      bannedAt: null,
    });
    await expect(caller.me()).resolves.toEqual({
      id: 'u-admin',
      email: 'admin@cardhub.test',
      username: 'admin',
      role: 'admin',
      passwordChangeRecommended: false,
      bannedAt: null,
    });
    expect(auth.verify).not.toHaveBeenCalled();
  });
});

describe('AuthRouter.changePassword', () => {
  it('returns WRONG_PASSWORD when the current password does not match', async () => {
    const { caller, userMock, auth } = makeRouter(signedInUser);
    userMock.findUnique.mockResolvedValueOnce({
      id: 'u1',
      username: 'alice',
      password: await bcrypt.hash(TEST_PASSWORD, 4),
    });

    await expect(
      caller.changePassword({
        currentPassword: INCORRECT_PASSWORD,
        newPassword: 'another-password',
      }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      cause: { appCode: APP_ERROR_CODES.WRONG_PASSWORD },
    });
    expect(userMock.update).not.toHaveBeenCalled();
    expect(auth.sign).not.toHaveBeenCalled();
  });

  it('returns SAME_PASSWORD without writing when the new password matches', async () => {
    const { caller, userMock, auth } = makeRouter(signedInUser);
    userMock.findUnique.mockResolvedValueOnce({
      id: 'u1',
      username: 'alice',
      password: await bcrypt.hash(TEST_PASSWORD, 4),
    });

    await expect(
      caller.changePassword({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: { appCode: APP_ERROR_CODES.SAME_PASSWORD },
    });
    expect(userMock.update).not.toHaveBeenCalled();
    expect(auth.sign).not.toHaveBeenCalled();
  });

  it('returns SAME_PASSWORD without writing even when prehash writes are enabled', async () => {
    const { caller, userMock, auth } = makeRouter(signedInUser, true);
    userMock.findUnique.mockResolvedValueOnce({
      id: 'u1',
      username: 'alice',
      password: await bcrypt.hash(TEST_PASSWORD, 4),
    });

    await expect(
      caller.changePassword({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: { appCode: APP_ERROR_CODES.SAME_PASSWORD },
    });
    expect(userMock.update).not.toHaveBeenCalled();
    expect(auth.sign).not.toHaveBeenCalled();
  });

  it('stores the new hash and increments tokenVersion in one update', async () => {
    const { caller, userMock, auth } = makeRouter(signedInUser);
    userMock.findUnique.mockResolvedValueOnce({
      id: 'u1',
      username: 'alice',
      password: await bcrypt.hash(TEST_PASSWORD, 4),
    });
    userMock.update.mockResolvedValueOnce({ id: 'u1', username: 'alice', tokenVersion: 3 });

    await expect(
      caller.changePassword({ currentPassword: TEST_PASSWORD, newPassword: 'another-password' }),
    ).resolves.toEqual({ token: 'signed.jwt.token' });

    const update = userMock.update.mock.calls[0]?.[0];
    expect(update.where).toEqual({ id: 'u1' });
    expect(update.data.tokenVersion).toEqual({ increment: 1 });
    expect(update.data.password.startsWith('$2')).toBe(true);
    expect(auth.sign).toHaveBeenCalledWith({ sub: 'u1', username: 'alice', ver: 3 });
  });

  it('stores a pre-hashed password when writes are enabled', async () => {
    const { caller, userMock } = makeRouter(signedInUser, true);
    userMock.findUnique.mockResolvedValueOnce({
      id: 'u1',
      username: 'alice',
      password: await bcrypt.hash(TEST_PASSWORD, 4),
    });
    userMock.update.mockResolvedValueOnce({ id: 'u1', username: 'alice', tokenVersion: 3 });

    await caller.changePassword({
      currentPassword: TEST_PASSWORD,
      newPassword: 'another-password',
    });

    const update = userMock.update.mock.calls[0]?.[0];
    expect(update.data.password.startsWith('sha256$')).toBe(true);
    expect(update.data.tokenVersion).toEqual({ increment: 1 });
  });
});

describe('AuthRouter.signOutAll', () => {
  it('increments tokenVersion and returns ok', async () => {
    const { caller, userMock, auth } = makeRouter(signedInUser);
    userMock.update.mockResolvedValueOnce({ tokenVersion: 1 });

    await expect(caller.signOutAll()).resolves.toEqual({ ok: true });
    expect(userMock.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(auth.sign).not.toHaveBeenCalled();
  });

  it('rejects anonymous callers', async () => {
    const { caller, userMock } = makeRouter();
    await expect(caller.signOutAll()).rejects.toBeInstanceOf(TRPCError);
    expect(userMock.update).not.toHaveBeenCalled();
  });
});
