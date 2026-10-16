import { TRPCError } from '@trpc/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { TrpcBase } from '../../trpc/trpc-base';
import { AuthRouter } from './auth.router';
import type { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';

const TEST_PASSWORD = randomUUID();
const WRONG_PASSWORD = randomUUID();

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
};

function makeRouter() {
  const userMock: MockPrismaUser = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  };
  const prisma = { user: userMock } as unknown as PrismaService;

  const auth = {
    sign: jest.fn().mockReturnValue('signed.jwt.token'),
    verify: jest.fn(),
  } as unknown as AuthService;

  const router = new AuthRouter(new TrpcBase(), prisma, auth);
  const caller = router.build().createCaller({
    req: {} as never,
    res: {} as never,
    user: null,
  });

  return { caller, userMock, auth };
}

describe('AuthRouter.register', () => {
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
    expect(createCall.data.password.length).toBeGreaterThan(20);
    expect(auth.sign).toHaveBeenCalledWith({ sub: 'u-new', username: 'alice' });
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
    });

    await expect(
      caller.login({ identifier: 'alice', password: WRONG_PASSWORD }),
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
    });
    expect(auth.sign).toHaveBeenCalledWith({ sub: 'u1', username: 'alice' });
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
  it('returns the current user including role when the token is valid', async () => {
    const { caller, userMock, auth } = makeRouter();
    auth.verify = jest.fn().mockReturnValue({ sub: 'u-admin', username: 'admin' });
    userMock.findUnique.mockResolvedValueOnce({
      id: 'u-admin',
      email: 'admin@cardhub.test',
      username: 'admin',
      role: 'admin',
    });

    await expect(caller.me({ token: 'valid.jwt.token' })).resolves.toEqual({
      id: 'u-admin',
      email: 'admin@cardhub.test',
      username: 'admin',
      role: 'admin',
    });
  });
});
