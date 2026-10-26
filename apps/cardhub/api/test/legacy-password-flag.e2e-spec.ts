import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { hashPassword } from '../src/modules/auth/password-hash';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const LONG = 'a'.repeat(73);
const EXACT = 'b'.repeat(72);
const SHORT = 'short-pass';

let sequence = 0;

function nextIdentity(label: string) {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
  return {
    email: `${label}-${suffix}@cardhub.test`,
    username: `${label}${suffix}`.replace(/[^a-z0-9]/gi, '').slice(0, 24),
    ip: `198.51.100.${(sequence % 200) + 1}`,
  };
}

function expectString(value: unknown): string {
  expect(typeof value).toBe('string');
  if (typeof value !== 'string') throw new Error('expected a string');
  return value;
}

function resultData(body: { result?: { data?: unknown } }): Record<string, unknown> {
  const data = body.result?.data;
  if (typeof data !== 'object' || data === null) throw new Error('expected a result object');
  return data;
}

function userFlag(data: Record<string, unknown>): boolean {
  const user = data.user;
  if (typeof user !== 'object' || user === null || !('passwordChangeRecommended' in user)) {
    throw new Error('expected passwordChangeRecommended');
  }
  const flag = user.passwordChangeRecommended;
  expect(typeof flag).toBe('boolean');
  if (typeof flag !== 'boolean') throw new Error('expected a boolean');
  return flag;
}

describe('legacy password change recommendation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreEnv: () => void;

  beforeAll(async () => {
    const previous = process.env.PASSWORD_PREHASH_WRITE;
    process.env.PASSWORD_PREHASH_WRITE = 'false';
    restoreEnv = () => {
      if (previous === undefined) delete process.env.PASSWORD_PREHASH_WRITE;
      else process.env.PASSWORD_PREHASH_WRITE = previous;
    };
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    restoreEnv();
  });

  async function register(identity: ReturnType<typeof nextIdentity>, password: string) {
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ email: identity.email, username: identity.username, password });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    const user = data.user;
    if (typeof user !== 'object' || user === null || !('id' in user)) {
      throw new Error('expected a user');
    }
    return { token: expectString(data.token), id: expectString(user.id) };
  }

  function login(identity: ReturnType<typeof nextIdentity>, password: string) {
    return request(app.getHttpServer())
      .post('/trpc/auth.login')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ identifier: identity.username, password });
  }

  it('sets the flag for a legacy hash over 72 bytes and leaves shorter ones unset', async () => {
    const longUser = nextIdentity('long');
    const registered = await register(longUser, LONG);
    const stored = await prisma.user.findUnique({
      where: { id: registered.id },
      select: { password: true, passwordChangeRecommended: true },
    });
    expect(stored?.password.startsWith('$2')).toBe(true);
    expect(stored?.passwordChangeRecommended).toBe(false);

    const signedIn = await login(longUser, LONG);
    expect(signedIn.status).toBe(200);
    expect(userFlag(resultData(signedIn.body))).toBe(true);
    const afterLong = await prisma.user.findUnique({
      where: { id: registered.id },
      select: { passwordChangeRecommended: true },
    });
    expect(afterLong?.passwordChangeRecommended).toBe(true);

    const shorterLogin = await login(longUser, 'a'.repeat(72));
    expect(shorterLogin.status).toBe(200);
    expect(userFlag(resultData(shorterLogin.body))).toBe(true);
    const stillSet = await prisma.user.findUnique({
      where: { id: registered.id },
      select: { passwordChangeRecommended: true },
    });
    expect(stillSet?.passwordChangeRecommended).toBe(true);

    const me = await request(app.getHttpServer())
      .get('/trpc/auth.me')
      .set('Authorization', `Bearer ${expectString(resultData(signedIn.body).token)}`);
    expect(me.status).toBe(200);
    expect(resultData(me.body).passwordChangeRecommended).toBe(true);

    const exactUser = nextIdentity('exact');
    const exactRegistered = await register(exactUser, EXACT);
    const exactLogin = await login(exactUser, EXACT);
    expect(exactLogin.status).toBe(200);
    expect(userFlag(resultData(exactLogin.body))).toBe(false);
    const exactRow = await prisma.user.findUnique({
      where: { id: exactRegistered.id },
      select: { passwordChangeRecommended: true },
    });
    expect(exactRow?.passwordChangeRecommended).toBe(false);
  });

  it('does not set the flag for a new hash and clears it after a password change', async () => {
    const identity = nextIdentity('newhash');
    const registered = await register(identity, SHORT);
    await prisma.user.update({
      where: { id: registered.id },
      data: {
        password: await hashPassword(LONG, { prehash: true }),
        passwordChangeRecommended: false,
      },
    });

    const signedIn = await login(identity, LONG);
    expect(signedIn.status).toBe(200);
    expect(userFlag(resultData(signedIn.body))).toBe(false);
    const row = await prisma.user.findUnique({
      where: { id: registered.id },
      select: { passwordChangeRecommended: true, password: true },
    });
    expect(row?.passwordChangeRecommended).toBe(false);
    expect(row?.password.startsWith('sha256$')).toBe(true);

    const legacy = nextIdentity('clear');
    const legacyUser = await register(legacy, LONG);
    const flagged = await login(legacy, LONG);
    expect(userFlag(resultData(flagged.body))).toBe(true);
    const token = expectString(resultData(flagged.body).token);

    const changed = await request(app.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', legacy.ip)
      .send({ currentPassword: LONG, newPassword: SHORT });
    expect(changed.status).toBe(200);
    const nextToken = expectString(resultData(changed.body).token);
    const cleared = await prisma.user.findUnique({
      where: { id: legacyUser.id },
      select: { passwordChangeRecommended: true },
    });
    expect(cleared?.passwordChangeRecommended).toBe(false);

    const me = await request(app.getHttpServer())
      .get('/trpc/auth.me')
      .set('Authorization', `Bearer ${nextToken}`);
    expect(me.status).toBe(200);
    expect(resultData(me.body).passwordChangeRecommended).toBe(false);

    const again = await login(legacy, SHORT);
    expect(again.status).toBe(200);
    expect(userFlag(resultData(again.body))).toBe(false);
  });
});
