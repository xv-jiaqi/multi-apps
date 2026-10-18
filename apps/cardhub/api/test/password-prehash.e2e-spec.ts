import { Logger, type INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { hashPassword } from '../src/modules/auth/password-hash';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const NEW_HASH_PREFIX = 'sha256$';

let sequence = 0;

function nextIdentity(label: string) {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
  return {
    email: `${label}-${suffix}@cardhub.test`,
    username: `p${suffix}`.slice(0, 24),
    ip: `203.0.113.${(sequence % 200) + 1}`,
  };
}

function expectString(value: unknown): string {
  expect(typeof value).toBe('string');
  if (typeof value !== 'string') {
    throw new Error('expected a string');
  }
  return value;
}

function resultData(body: { result?: { data?: unknown } }): Record<string, unknown> {
  const data = body.result?.data;
  expect(data).toEqual(expect.any(Object));
  if (typeof data !== 'object' || data === null) {
    throw new Error('expected a result object');
  }
  return data;
}

async function register(
  app: INestApplication,
  identity: ReturnType<typeof nextIdentity>,
  password: string,
) {
  const response = await request(app.getHttpServer())
    .post('/trpc/auth.register')
    .set('Content-Type', 'application/json')
    .set('X-Forwarded-For', identity.ip)
    .send({
      email: identity.email,
      username: identity.username,
      password,
    });
  expect(response.status).toBe(200);
  const data = resultData(response.body);
  const user = data.user;
  if (typeof user !== 'object' || user === null || !('id' in user)) {
    throw new Error('expected a user');
  }
  return { token: expectString(data.token), id: expectString(user.id) };
}

function login(app: INestApplication, identity: ReturnType<typeof nextIdentity>, password: string) {
  return request(app.getHttpServer())
    .post('/trpc/auth.login')
    .set('Content-Type', 'application/json')
    .set('X-Forwarded-For', identity.ip)
    .send({ identifier: identity.username, password });
}

function withPrehashWrite(enabled: boolean) {
  const previous = process.env.PASSWORD_PREHASH_WRITE;
  process.env.PASSWORD_PREHASH_WRITE = enabled ? 'true' : 'false';
  return () => {
    if (previous === undefined) {
      delete process.env.PASSWORD_PREHASH_WRITE;
    } else {
      process.env.PASSWORD_PREHASH_WRITE = previous;
    }
  };
}

describe('password pre-hash writes disabled', () => {
  let app: INestApplication;
  let restoreEnv: () => void;

  beforeAll(async () => {
    restoreEnv = withPrehashWrite(false);
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    restoreEnv();
  });

  it('writes legacy hashes, does not upgrade on login, and still verifies a new hash', async () => {
    const identity = nextIdentity('flag-off');
    const password = 'legacy-write-password';
    const nextPassword = 'legacy-write-password-2';

    const registered = await register(app, identity, password);
    const prisma = app.get(PrismaService);
    const created = await prisma.user.findUnique({
      where: { id: registered.id },
      select: { password: true },
    });
    expect(created?.password.startsWith('$2')).toBe(true);
    expect(created?.password.startsWith(NEW_HASH_PREFIX)).toBe(false);

    const signedIn = await login(app, identity, password);
    expect(signedIn.status).toBe(200);
    const afterLogin = await prisma.user.findUnique({
      where: { id: registered.id },
      select: { password: true },
    });
    expect(afterLogin?.password).toBe(created?.password);

    const planted = await hashPassword(password, { prehash: true });
    await prisma.user.update({
      where: { id: registered.id },
      data: { password: planted },
    });
    const newFormatLogin = await login(app, identity, password);
    expect(newFormatLogin.status).toBe(200);
    const afterNewFormat = await prisma.user.findUnique({
      where: { id: registered.id },
      select: { password: true },
    });
    expect(afterNewFormat?.password).toBe(planted);

    const changed = await request(app.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${registered.token}`)
      .set('X-Forwarded-For', identity.ip)
      .send({ currentPassword: password, newPassword: nextPassword });
    expect(changed.status).toBe(200);
    const afterChange = await prisma.user.findUnique({
      where: { id: registered.id },
      select: { password: true },
    });
    expect(afterChange?.password.startsWith('$2')).toBe(true);
    expect(afterChange?.password.startsWith(NEW_HASH_PREFIX)).toBe(false);
    await expect(bcrypt.compare(nextPassword, afterChange?.password ?? '')).resolves.toBe(true);
  });
});

describe('password pre-hash writes enabled', () => {
  let app: INestApplication;
  let restoreEnv: () => void;

  beforeAll(async () => {
    restoreEnv = withPrehashWrite(true);
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    restoreEnv();
  });

  it('rejects a password that matches only the first 72 bytes, including a Chinese tail', async () => {
    const identity = nextIdentity('tail');
    const head = 'a'.repeat(72);
    const registeredPassword = `${head}tail`;
    const samePrefixChineseTail = `${head}尾巴`;

    await register(app, identity, registeredPassword);

    const rejected = await login(app, identity, samePrefixChineseTail);
    expect(rejected.status).toBe(401);

    const accepted = await login(app, identity, registeredPassword);
    expect(accepted.status).toBe(200);
  });

  it('upgrades a legacy bcrypt hash to the new format after a successful login', async () => {
    const identity = nextIdentity('legacy');
    const password = 'legacy-horse-correct';
    const legacyHash = await bcrypt.hash(password, 4);
    expect(legacyHash.startsWith(NEW_HASH_PREFIX)).toBe(false);

    const prisma = app.get(PrismaService);
    const created = await prisma.user.create({
      data: {
        email: identity.email,
        username: identity.username,
        password: legacyHash,
      },
      select: { id: true, password: true },
    });
    expect(created.password).toBe(legacyHash);

    const signedIn = await login(app, identity, password);
    expect(signedIn.status).toBe(200);

    const stored = await prisma.user.findUnique({
      where: { id: created.id },
      select: { password: true, tokenVersion: true },
    });
    expect(stored?.password.startsWith(NEW_HASH_PREFIX)).toBe(true);
    expect(stored?.password).not.toBe(legacyHash);
    expect(stored?.tokenVersion).toBe(0);
    await expect(bcrypt.compare(password, stored?.password ?? '')).resolves.toBe(false);

    const again = await login(app, identity, password);
    expect(again.status).toBe(200);
  });

  it('registers, logs in, and changes a 128-character password', async () => {
    const identity = nextIdentity('long');
    const head = 'b'.repeat(72);
    const password = `${head}${'c'.repeat(53)}中文尾`;
    const nextPassword = `${head}${'d'.repeat(53)}新密码`;
    const samePrefix = `${head}${'e'.repeat(56)}`;
    expect(password).toHaveLength(128);
    expect(nextPassword).toHaveLength(128);
    expect(
      Buffer.from(password).subarray(0, 72).equals(Buffer.from(samePrefix).subarray(0, 72)),
    ).toBe(true);

    const registered = await register(app, identity, password);
    const signedIn = await login(app, identity, password);
    expect(signedIn.status).toBe(200);
    const cousin = await login(app, identity, samePrefix);
    expect(cousin.status).toBe(401);

    const changed = await request(app.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${registered.token}`)
      .set('X-Forwarded-For', identity.ip)
      .send({ currentPassword: password, newPassword: nextPassword });
    expect(changed.status).toBe(200);

    const oldPassword = await login(app, identity, password);
    expect(oldPassword.status).toBe(401);
    const withNext = await login(app, identity, nextPassword);
    expect(withNext.status).toBe(200);

    const stored = await app.get(PrismaService).user.findUnique({
      where: { id: registered.id },
      select: { password: true },
    });
    expect(stored?.password.startsWith(NEW_HASH_PREFIX)).toBe(true);
  });

  it('does not upgrade a legacy hash when the password is longer than 72 bytes', async () => {
    const identity = nextIdentity('long-legacy');
    const password = '密'.repeat(25);
    expect(password.length).toBeLessThanOrEqual(72);
    expect(Buffer.byteLength(password)).toBeGreaterThan(72);
    const legacyHash = await bcrypt.hash(password, 4);

    const prisma = app.get(PrismaService);
    const created = await prisma.user.create({
      data: {
        email: identity.email,
        username: identity.username,
        password: legacyHash,
      },
      select: { id: true },
    });

    const signedIn = await login(app, identity, password);
    expect(signedIn.status).toBe(200);

    const stored = await prisma.user.findUnique({
      where: { id: created.id },
      select: { password: true },
    });
    expect(stored?.password).toBe(legacyHash);
    expect(stored?.password.startsWith('$2')).toBe(true);
  });

  it('still accepts the real password after a same-prefix impostor logs in', async () => {
    const identity = nextIdentity('impostor');
    const head = 'd'.repeat(72);
    const password = `${head}真密码`;
    const impostor = `${head}假密码`;
    expect(Buffer.byteLength(password)).toBeGreaterThan(72);
    expect(Buffer.byteLength(impostor)).toBeGreaterThan(72);
    expect(
      Buffer.from(password).subarray(0, 72).equals(Buffer.from(impostor).subarray(0, 72)),
    ).toBe(true);
    const legacyHash = await bcrypt.hash(password, 4);

    const prisma = app.get(PrismaService);
    const created = await prisma.user.create({
      data: {
        email: identity.email,
        username: identity.username,
        password: legacyHash,
      },
      select: { id: true },
    });

    const asImpostor = await login(app, identity, impostor);
    expect(asImpostor.status).toBe(200);
    const afterImpostor = await prisma.user.findUnique({
      where: { id: created.id },
      select: { password: true },
    });
    expect(afterImpostor?.password).toBe(legacyHash);

    const asOwner = await login(app, identity, password);
    expect(asOwner.status).toBe(200);
    const afterOwner = await prisma.user.findUnique({
      where: { id: created.id },
      select: { password: true },
    });
    expect(afterOwner?.password).toBe(legacyHash);
  });

  it('rejects the same-prefix impostor after changePassword', async () => {
    const identity = nextIdentity('changed-long');
    const head = 'e'.repeat(72);
    const password = `${head}真密码`;
    const impostor = `${head}假密码`;
    const nextPassword = `${head}新密码`;
    expect(Buffer.byteLength(password)).toBeGreaterThan(72);
    expect(Buffer.byteLength(nextPassword)).toBeGreaterThan(72);
    expect(
      Buffer.from(password).subarray(0, 72).equals(Buffer.from(impostor).subarray(0, 72)),
    ).toBe(true);
    const legacyHash = await bcrypt.hash(password, 4);

    const prisma = app.get(PrismaService);
    await prisma.user.create({
      data: {
        email: identity.email,
        username: identity.username,
        password: legacyHash,
      },
    });

    const signedIn = await login(app, identity, password);
    expect(signedIn.status).toBe(200);
    const token = expectString(resultData(signedIn.body).token);

    const changed = await request(app.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', identity.ip)
      .send({ currentPassword: password, newPassword: nextPassword });
    expect(changed.status).toBe(200);

    const rejected = await login(app, identity, impostor);
    expect(rejected.status).toBe(401);
    const accepted = await login(app, identity, nextPassword);
    expect(accepted.status).toBe(200);

    const stored = await prisma.user.findUnique({
      where: { username: identity.username },
      select: { password: true },
    });
    expect(stored?.password.startsWith(NEW_HASH_PREFIX)).toBe(true);
  });

  it('does not overwrite a password changed after the legacy hash was read', async () => {
    const identity = nextIdentity('cas');
    const password = 'legacy-before-change';
    const nextPassword = 'changed-while-login';
    const legacyHash = await bcrypt.hash(password, 4);
    const replacement = await hashPassword(nextPassword, { prehash: true });

    const prisma = app.get(PrismaService);
    const created = await prisma.user.create({
      data: {
        email: identity.email,
        username: identity.username,
        password: legacyHash,
      },
      select: { id: true },
    });

    const findFirst = prisma.user.findFirst.bind(prisma.user);
    const read = jest.spyOn(prisma.user, 'findFirst').mockImplementation(async (args) => {
      const found = await findFirst(args);
      if (found && 'password' in found && found.id === created.id) {
        await prisma.user.update({
          where: { id: created.id },
          data: { password: replacement },
        });
      }
      return found;
    });

    try {
      const inFlight = await login(app, identity, password);
      expect(inFlight.status).toBe(200);

      const stored = await prisma.user.findUnique({
        where: { id: created.id },
        select: { password: true },
      });
      expect(stored?.password).toBe(replacement);

      const withNext = await login(app, identity, nextPassword);
      expect(withNext.status).toBe(200);
      const withOld = await login(app, identity, password);
      expect(withOld.status).toBe(401);
    } finally {
      read.mockRestore();
    }
  });

  it('logs in when the upgrade write fails and reports the error', async () => {
    const identity = nextIdentity('upgrade-fail');
    const password = 'legacy-write-fails';
    const legacyHash = await bcrypt.hash(password, 4);
    const prisma = app.get(PrismaService);
    const created = await prisma.user.create({
      data: {
        email: identity.email,
        username: identity.username,
        password: legacyHash,
      },
      select: { id: true },
    });

    const updateMany = jest
      .spyOn(prisma.user, 'updateMany')
      .mockRejectedValueOnce(new Error('upgrade write failed'));
    const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    try {
      const signedIn = await login(app, identity, password);
      expect(signedIn.status).toBe(200);
      expect(loggerError).toHaveBeenCalledWith('upgrade write failed', expect.any(String));

      const stored = await prisma.user.findUnique({
        where: { id: created.id },
        select: { password: true },
      });
      expect(stored?.password).toBe(legacyHash);
    } finally {
      updateMany.mockRestore();
      loggerError.mockRestore();
    }
  });
});
