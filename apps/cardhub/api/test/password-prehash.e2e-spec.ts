import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
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

describe('password pre-hash', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
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
});
