import type { INestApplication } from '@nestjs/common';
import { APP_ERROR_CODES } from '@repo/shared';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { AuthService } from '../src/modules/auth/auth.service';
import {
  clearMemoryPasswordResetMails,
  memoryPasswordResetMails,
} from '../src/modules/auth/password-reset-mailer';
import { hashPasswordResetToken } from '../src/modules/auth/password-reset-token';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const PASSWORD = 'correct-horse';
const NEXT_PASSWORD = 'correct-horse-2';

let sequence = 0;

function nextIdentity(label: string) {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
  return {
    email: `${label}-${suffix}@cardhub.test`,
    username: `r${suffix}`.slice(0, 24),
    password: PASSWORD,
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

function appCode(body: { error?: { data?: { appCode?: unknown } } }): unknown {
  return body.error?.data?.appCode;
}

async function register(app: INestApplication, identity: ReturnType<typeof nextIdentity>) {
  const response = await request(app.getHttpServer())
    .post('/trpc/auth.register')
    .set('Content-Type', 'application/json')
    .set('X-Forwarded-For', identity.ip)
    .send({
      email: identity.email,
      username: identity.username,
      password: identity.password,
    });
  expect(response.status).toBe(200);
  const data = resultData(response.body);
  const user = data.user;
  expect(user).toEqual(expect.any(Object));
  if (typeof user !== 'object' || user === null || !('id' in user)) {
    throw new Error('expected a user');
  }
  return { token: expectString(data.token), id: expectString(user.id) };
}

describe('password reset API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const previousProvider = process.env.MAIL_PROVIDER;

  beforeAll(async () => {
    delete process.env.MAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(() => {
    clearMemoryPasswordResetMails();
    delete process.env.MAIL_PROVIDER;
  });

  afterAll(async () => {
    if (previousProvider === undefined) delete process.env.MAIL_PROVIDER;
    else process.env.MAIL_PROVIDER = previousProvider;
    await app?.close();
  });

  it('fails with MAIL_NOT_CONFIGURED and writes no token when mail is unset (46-1)', async () => {
    const identity = nextIdentity('nomail');
    const registered = await register(app, identity);
    const before = await prisma.passwordResetToken.count({ where: { userId: registered.id } });

    const response = await request(app.getHttpServer())
      .post('/trpc/auth.requestPasswordReset')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ email: identity.email });

    expect(response.status).toBe(412);
    expect(appCode(response.body)).toBe(APP_ERROR_CODES.MAIL_NOT_CONFIGURED);
    const after = await prisma.passwordResetToken.count({ where: { userId: registered.id } });
    expect(after).toBe(before);
    expect(after).toBe(0);
  });

  it('returns ok and writes no row for an unknown email when mail is configured (46-2)', async () => {
    process.env.MAIL_PROVIDER = 'memory';
    const email = nextIdentity('missing').email;

    const response = await request(app.getHttpServer())
      .post('/trpc/auth.requestPasswordReset')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.250')
      .send({ email });

    expect(response.status).toBe(200);
    expect(resultData(response.body)).toEqual({ ok: true });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(memoryPasswordResetMails()).toHaveLength(0);
  });

  it('stores a hash with a 15-minute expiry and never the plaintext token (46-3)', async () => {
    process.env.MAIL_PROVIDER = 'memory';
    const identity = nextIdentity('hash');
    const registered = await register(app, identity);
    const started = Date.now();

    const response = await request(app.getHttpServer())
      .post('/trpc/auth.requestPasswordReset')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ email: identity.email.toUpperCase() });

    expect(response.status).toBe(200);
    expect(resultData(response.body)).toEqual({ ok: true });
    const mails = memoryPasswordResetMails();
    expect(mails).toHaveLength(1);
    const plaintext = mails[0]?.token;
    expect(typeof plaintext).toBe('string');
    if (typeof plaintext !== 'string') throw new Error('expected a token');
    expect(mails[0]?.to).toBe(identity.email);

    const rows = await prisma.passwordResetToken.findMany({ where: { userId: registered.id } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error('expected a token row');
    expect(row.usedAt).toBeNull();
    expect(row.tokenHash).toBe(hashPasswordResetToken(plaintext));
    expect(row.tokenHash).not.toBe(plaintext);
    expect(JSON.stringify(row)).not.toContain(plaintext);
    const ttl = row.expiresAt.getTime() - started;
    expect(ttl).toBeGreaterThanOrEqual(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(16 * 60_000);
  });

  it('resets the password, revokes old JWTs, and rejects a reused token (46-4)', async () => {
    process.env.MAIL_PROVIDER = 'memory';
    const identity = nextIdentity('reset');
    const registered = await register(app, identity);
    const auth = app.get(AuthService);
    expect(auth.verify(registered.token).ver).toBe(0);

    const requested = await request(app.getHttpServer())
      .post('/trpc/auth.requestPasswordReset')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ email: identity.email });
    expect(requested.status).toBe(200);
    const plaintext = memoryPasswordResetMails()[0]?.token;
    expect(typeof plaintext).toBe('string');
    if (typeof plaintext !== 'string') throw new Error('expected a token');

    const reset = await request(app.getHttpServer())
      .post('/trpc/auth.resetPassword')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ token: plaintext, newPassword: NEXT_PASSWORD });
    expect(reset.status).toBe(200);
    expect(resultData(reset.body)).toEqual({ ok: true });
    expect(reset.body.result.data).not.toHaveProperty('token');

    const oldSession = await request(app.getHttpServer())
      .get('/trpc/users.me')
      .set('Authorization', `Bearer ${registered.token}`);
    expect(oldSession.status).toBe(401);
    expect(appCode(oldSession.body)).toBe(APP_ERROR_CODES.UNAUTHORIZED);

    const login = await request(app.getHttpServer())
      .post('/trpc/auth.login')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ identifier: identity.username, password: NEXT_PASSWORD });
    expect(login.status).toBe(200);
    const nextToken = expectString(resultData(login.body).token);
    expect(auth.verify(nextToken).ver).toBe(1);

    const oldPassword = await request(app.getHttpServer())
      .post('/trpc/auth.login')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ identifier: identity.username, password: PASSWORD });
    expect(oldPassword.status).toBe(401);

    const row = await prisma.passwordResetToken.findFirst({ where: { userId: registered.id } });
    expect(row?.usedAt).toEqual(expect.any(Date));

    const reused = await request(app.getHttpServer())
      .post('/trpc/auth.resetPassword')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ token: plaintext, newPassword: 'another-password' });
    expect(reused.status).toBe(400);
    expect(appCode(reused.body)).toBe(APP_ERROR_CODES.RESET_TOKEN_INVALID);
  });
});
