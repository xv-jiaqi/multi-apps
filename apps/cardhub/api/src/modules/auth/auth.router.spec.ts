import { TRPCError } from '@trpc/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { APP_ERROR_CODES } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import type { TrpcContext } from '../../trpc/context';
import { AuthRouter, type AuthRouterDeps } from './auth.router';
import { hashPasswordResetToken } from './password-reset-token';
import { BCRYPT_ROUNDS, DUMMY_PASSWORD_HASH } from './password-hash';
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

type MockPrismaResetToken = {
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
};

function makeRouter(
  user: TrpcContext['user'] = null,
  prehashWrite = false,
  req: TrpcContext['req'] = {} as TrpcContext['req'],
  deps: AuthRouterDeps = {},
) {
  const userMock: MockPrismaUser = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const resetTokenMock: MockPrismaResetToken = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const tx = { user: userMock, passwordResetToken: resetTokenMock };
  const prisma = {
    user: userMock,
    passwordResetToken: resetTokenMock,
    $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;

  const auth = {
    sign: jest.fn().mockReturnValue('signed.jwt.token'),
    verify: jest.fn(),
  } as unknown as AuthService;

  const previous = process.env.PASSWORD_PREHASH_WRITE;
  process.env.PASSWORD_PREHASH_WRITE = prehashWrite ? 'true' : 'false';
  const router = new AuthRouter(new TrpcBase(), prisma, auth);
  const caller = router.build(deps).createCaller({
    req,
    res: {} as never,
    user,
  });
  if (previous === undefined) {
    delete process.env.PASSWORD_PREHASH_WRITE;
  } else {
    process.env.PASSWORD_PREHASH_WRITE = previous;
  }

  return { caller, userMock, resetTokenMock, auth, prisma };
}

const signedInUser = {
  sub: 'u1',
  username: 'alice',
  role: 'user',
  tokenVersion: 0,
  bannedAt: null,
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
    const compare = jest.spyOn(bcrypt, 'compare');
    const { caller, userMock } = makeRouter();
    userMock.findFirst.mockResolvedValueOnce(null);

    try {
      await expect(
        caller.login({ identifier: 'nobody', password: TEST_PASSWORD }),
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: '用户名或密码错误',
      });
      expect(DUMMY_PASSWORD_HASH.split('$')[2]).toBe(String(BCRYPT_ROUNDS));
      expect(compare).toHaveBeenCalledWith(TEST_PASSWORD, DUMMY_PASSWORD_HASH);
    } finally {
      compare.mockRestore();
    }
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

  it('clears the account limit after a valid login and keeps the token when reset fails', async () => {
    const clear = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('redis unavailable'));
    const req = {
      app: { get: () => clear },
    } as unknown as TrpcContext['req'];
    const { caller, userMock } = makeRouter(null, false, req);
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 4);
    userMock.findFirst.mockResolvedValue({
      id: 'u1',
      email: 'alice@cardhub.test',
      username: 'alice',
      password: hashedPassword,
      role: 'admin',
      tokenVersion: 4,
    });

    const first = await caller.login({ identifier: 'Alice', password: TEST_PASSWORD });
    expect(first.token).toBe('signed.jwt.token');
    expect(clear).toHaveBeenCalledWith('Alice');

    const second = await caller.login({ identifier: 'Alice', password: TEST_PASSWORD });
    expect(second.token).toBe('signed.jwt.token');
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it('does not clear the account limit when the password is wrong', async () => {
    const clear = jest.fn();
    const req = {
      app: { get: () => clear },
    } as unknown as TrpcContext['req'];
    const { caller, userMock } = makeRouter(null, false, req);
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 4);
    userMock.findFirst.mockResolvedValueOnce({
      id: 'u1',
      email: 'alice@cardhub.test',
      username: 'alice',
      password: hashedPassword,
      role: 'admin',
      tokenVersion: 4,
    });

    await expect(
      caller.login({ identifier: 'alice', password: INCORRECT_PASSWORD }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('AuthRouter.me', () => {
  const currentUser = {
    sub: 'u-admin',
    username: 'admin',
    role: 'admin',
    tokenVersion: 0,
    bannedAt: null,
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

const configuredMailEnv = {
  MAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test',
};

describe('AuthRouter.requestPasswordReset', () => {
  it('fails with MAIL_NOT_CONFIGURED and writes no token when mail is off', async () => {
    const { caller, resetTokenMock, userMock } = makeRouter(null, false, {} as TrpcContext['req'], {
      env: () => ({}),
    });

    await expect(caller.requestPasswordReset({ email: 'a@b.co' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      cause: { appCode: APP_ERROR_CODES.MAIL_NOT_CONFIGURED },
    });
    expect(resetTokenMock.create).not.toHaveBeenCalled();
    expect(userMock.findUnique).not.toHaveBeenCalled();
  });

  it('returns ok and writes no token when mail is configured and the email is unknown', async () => {
    const mailer = { sendPasswordReset: jest.fn() };
    const { caller, resetTokenMock, userMock } = makeRouter(null, false, {} as TrpcContext['req'], {
      env: () => configuredMailEnv,
      mailer,
    });
    userMock.findUnique.mockResolvedValueOnce(null);

    await expect(caller.requestPasswordReset({ email: '  Nobody@Cardhub.test ' })).resolves.toEqual(
      {
        ok: true,
      },
    );
    expect(userMock.findUnique).toHaveBeenCalledWith({
      where: { email: 'nobody@cardhub.test' },
      select: { id: true, email: true },
    });
    expect(resetTokenMock.create).not.toHaveBeenCalled();
    expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('stores a hash, not the plaintext token, and mails the plaintext when the user exists', async () => {
    const mailer = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    const now = new Date('2026-11-18T04:00:00.000Z');
    const { caller, resetTokenMock, userMock } = makeRouter(null, false, {} as TrpcContext['req'], {
      env: () => configuredMailEnv,
      mailer,
      now: () => now,
      newToken: () => 'plain-reset-token',
    });
    userMock.findUnique.mockResolvedValueOnce({ id: 'u1', email: 'alice@cardhub.test' });
    resetTokenMock.create.mockResolvedValueOnce({ id: 't1' });

    await expect(caller.requestPasswordReset({ email: 'alice@cardhub.test' })).resolves.toEqual({
      ok: true,
    });

    const created = resetTokenMock.create.mock.calls[0]?.[0];
    expect(created.data.userId).toBe('u1');
    expect(created.data.tokenHash).toBe(hashPasswordResetToken('plain-reset-token'));
    expect(created.data.tokenHash).not.toBe('plain-reset-token');
    expect(JSON.stringify(created)).not.toContain('plain-reset-token');
    expect(created.data.expiresAt).toEqual(new Date('2026-11-18T04:15:00.000Z'));
    expect(mailer.sendPasswordReset).toHaveBeenCalledWith({
      to: 'alice@cardhub.test',
      token: 'plain-reset-token',
      expiresAt: created.data.expiresAt,
    });
  });

  it('does not write a token when mail is marked configured but sending is not wired', async () => {
    const { caller, resetTokenMock, userMock } = makeRouter(null, false, {} as TrpcContext['req'], {
      env: () => configuredMailEnv,
    });

    await expect(
      caller.requestPasswordReset({ email: 'alice@cardhub.test' }),
    ).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      cause: { appCode: APP_ERROR_CODES.NOT_IMPLEMENTED },
    });
    expect(resetTokenMock.create).not.toHaveBeenCalled();
    expect(userMock.findUnique).not.toHaveBeenCalled();
  });
});

describe('AuthRouter.resetPassword', () => {
  const token = 'plain-reset-token';
  const tokenHash = hashPasswordResetToken(token);

  it('rejects a token when updateMany claims no unused, unexpired row', async () => {
    const now = new Date('2026-11-18T04:10:00.000Z');
    const { caller, resetTokenMock, userMock, auth } = makeRouter(
      null,
      false,
      {} as TrpcContext['req'],
      { now: () => now },
    );

    resetTokenMock.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      caller.resetPassword({ token, newPassword: 'new-password' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: { appCode: APP_ERROR_CODES.RESET_TOKEN_INVALID },
    });

    expect(resetTokenMock.updateMany).toHaveBeenCalledWith({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    expect(resetTokenMock.findUnique).not.toHaveBeenCalled();
    expect(userMock.update).not.toHaveBeenCalled();
    expect(auth.sign).not.toHaveBeenCalled();
  });

  it('treats a second updateMany count of 0 as an invalid token', async () => {
    const now = new Date('2026-11-18T04:10:00.000Z');
    const { caller, resetTokenMock, userMock, auth } = makeRouter(
      null,
      false,
      {} as TrpcContext['req'],
      { now: () => now },
    );
    let claims = 0;
    resetTokenMock.updateMany.mockImplementation(async () => {
      claims += 1;
      return { count: claims === 1 ? 1 : 0 };
    });
    resetTokenMock.findUnique.mockResolvedValue({ userId: 'u1' });
    userMock.update.mockResolvedValue({ id: 'u1' });

    const results = await Promise.allSettled([
      caller.resetPassword({ token, newPassword: 'new-password-a' }),
      caller.resetPassword({ token, newPassword: 'new-password-b' }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({ status: 'fulfilled', value: { ok: true } });
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status !== 'rejected') {
      throw new Error('expected one reset to fail');
    }
    expect(rejected[0].reason).toMatchObject({
      code: 'BAD_REQUEST',
      cause: { appCode: APP_ERROR_CODES.RESET_TOKEN_INVALID },
    });
    expect(resetTokenMock.updateMany).toHaveBeenCalledTimes(2);
    expect(userMock.update).toHaveBeenCalledTimes(1);
    expect(auth.sign).not.toHaveBeenCalled();
  });

  it('updates the password after a successful claim and does not issue a JWT', async () => {
    const now = new Date('2026-11-18T04:10:00.000Z');
    const { caller, resetTokenMock, userMock, auth } = makeRouter(
      null,
      false,
      {} as TrpcContext['req'],
      { now: () => now },
    );
    resetTokenMock.updateMany.mockResolvedValueOnce({ count: 1 });
    resetTokenMock.findUnique.mockResolvedValueOnce({ userId: 'u1' });
    userMock.update.mockResolvedValueOnce({ id: 'u1' });

    await expect(caller.resetPassword({ token, newPassword: 'new-password' })).resolves.toEqual({
      ok: true,
    });

    expect(resetTokenMock.updateMany).toHaveBeenCalledWith({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    expect(resetTokenMock.findUnique).toHaveBeenCalledWith({
      where: { tokenHash },
      select: { userId: true },
    });
    const userUpdate = userMock.update.mock.calls[0]?.[0];
    expect(userUpdate.where).toEqual({ id: 'u1' });
    expect(userUpdate.data.tokenVersion).toEqual({ increment: 1 });
    expect(userUpdate.data.passwordChangeRecommended).toBe(false);
    expect(userUpdate.data.password).not.toBe('new-password');
    expect(userUpdate.data.password.startsWith('$2')).toBe(true);
    expect(auth.sign).not.toHaveBeenCalled();
  });

  it('rejects the token if the claimed row disappears before the password update', async () => {
    const now = new Date('2026-11-18T04:10:00.000Z');
    const { caller, resetTokenMock, userMock, auth } = makeRouter(
      null,
      false,
      {} as TrpcContext['req'],
      { now: () => now },
    );
    resetTokenMock.updateMany.mockResolvedValueOnce({ count: 1 });
    resetTokenMock.findUnique.mockResolvedValueOnce(null);

    await expect(
      caller.resetPassword({ token, newPassword: 'new-password' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: { appCode: APP_ERROR_CODES.RESET_TOKEN_INVALID },
    });
    expect(userMock.update).not.toHaveBeenCalled();
    expect(auth.sign).not.toHaveBeenCalled();
  });
});
