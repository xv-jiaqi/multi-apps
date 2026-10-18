import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_ERROR_CODES, t } from '@repo/shared';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const PASSWORD = 'correct-horse';
const NEXT_PASSWORD = 'correct-horse-2';

let sequence = 0;

function nextIdentity(label: string) {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
  return {
    email: `${label}-${suffix}@cardhub.test`,
    username: `u${suffix}`.slice(0, 24),
    password: PASSWORD,
    ip: `198.51.100.${(sequence % 200) + 1}`,
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

async function login(
  app: INestApplication,
  identity: ReturnType<typeof nextIdentity>,
  password = identity.password,
) {
  const response = await request(app.getHttpServer())
    .post('/trpc/auth.login')
    .set('Content-Type', 'application/json')
    .set('X-Forwarded-For', identity.ip)
    .send({ identifier: identity.username, password });
  expect(response.status).toBe(200);
  return { token: expectString(resultData(response.body).token) };
}

function usersMe(app: INestApplication, token: string) {
  return request(app.getHttpServer()).get('/trpc/users.me').set('Authorization', `Bearer ${token}`);
}

describe('auth session revocation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('revokes every previous token after changePassword and accepts the new one', async () => {
    const identity = nextIdentity('pw');
    const registered = await register(app, identity);
    const otherSession = await login(app, identity);
    const auth = app.get(AuthService);
    expect(auth.verify(registered.token).ver).toBe(0);
    expect(auth.verify(otherSession.token).ver).toBe(0);

    const changed = await request(app.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${registered.token}`)
      .set('X-Forwarded-For', identity.ip)
      .send({ currentPassword: PASSWORD, newPassword: NEXT_PASSWORD });

    expect(changed.status).toBe(200);
    const nextToken = expectString(resultData(changed.body).token);
    expect(auth.verify(nextToken).ver).toBe(1);
    expect(Object.keys(resultData(changed.body))).toEqual(['token']);

    const old = await usersMe(app, registered.token);
    const other = await usersMe(app, otherSession.token);
    const current = await usersMe(app, nextToken);
    expect(old.status).toBe(401);
    expect(old.body.error.data.code).toBe('UNAUTHORIZED');
    expect(old.body.error.data).not.toHaveProperty('appCode');
    expect(other.status).toBe(401);
    expect(current.status).toBe(200);
    expect(resultData(current.body)).toEqual(expect.objectContaining({ id: registered.id }));
  });

  it('revokes every old token after signOutAll', async () => {
    const identity = nextIdentity('out');
    const first = await register(app, identity);
    const second = await login(app, identity);

    const response = await request(app.getHttpServer())
      .post('/trpc/auth.signOutAll')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${first.token}`)
      .set('X-Forwarded-For', identity.ip)
      .send({});

    expect(response.status).toBe(200);
    expect(resultData(response.body)).toEqual({ ok: true });
    expect((await usersMe(app, first.token)).status).toBe(401);
    expect((await usersMe(app, second.token)).status).toBe(401);
  });

  it('accepts a token that has no ver while tokenVersion is still 0', async () => {
    const identity = nextIdentity('legacy');
    const registered = await register(app, identity);
    const legacy = app.get(JwtService).sign({ sub: registered.id, username: identity.username });
    expect(app.get(AuthService).verify(legacy).ver).toBeUndefined();

    const response = await usersMe(app, legacy);
    expect(response.status).toBe(200);
    expect(resultData(response.body)).toEqual(expect.objectContaining({ id: registered.id }));
  });

  it('reads auth.me from the header and ignores input, with or without it', async () => {
    const identity = nextIdentity('me');
    const other = nextIdentity('meother');
    const registered = await register(app, identity);
    const otherUser = await register(app, other);

    const withInput = await request(app.getHttpServer())
      .get('/trpc/auth.me')
      .query({ input: JSON.stringify({ token: otherUser.token }) })
      .set('Authorization', `Bearer ${registered.token}`);
    const withoutInput = await request(app.getHttpServer())
      .get('/trpc/auth.me')
      .set('Authorization', `Bearer ${registered.token}`);
    const inputOnly = await request(app.getHttpServer())
      .get('/trpc/auth.me')
      .query({ input: JSON.stringify({ token: registered.token }) });

    expect(withInput.status).toBe(200);
    expect(withoutInput.status).toBe(200);
    expect(resultData(withInput.body)).toEqual(resultData(withoutInput.body));
    expect(resultData(withInput.body)).toEqual(
      expect.objectContaining({
        id: registered.id,
        email: identity.email,
        username: identity.username,
        role: 'user',
      }),
    );
    expect(Object.keys(resultData(withInput.body)).sort()).toEqual([
      'email',
      'id',
      'role',
      'username',
    ]);
    expect(inputOnly.status).toBe(401);
    expect(inputOnly.body.error.data).not.toHaveProperty('appCode');
  });

  it('returns WRONG_PASSWORD and SAME_PASSWORD on error.data.appCode', async () => {
    const identity = nextIdentity('code');
    const registered = await register(app, identity);

    const wrong = await request(app.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${registered.token}`)
      .set('X-Forwarded-For', identity.ip)
      .send({ currentPassword: 'not-the-password', newPassword: NEXT_PASSWORD });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.data.code).toBe('UNAUTHORIZED');
    expect(wrong.body.error.data.appCode).toBe(APP_ERROR_CODES.WRONG_PASSWORD);
    expect(wrong.body.error.message).toBe('当前密码不正确');

    const same = await request(app.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${registered.token}`)
      .set('X-Forwarded-For', identity.ip)
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.error.data.code).toBe('BAD_REQUEST');
    expect(same.body.error.data.appCode).toBe(APP_ERROR_CODES.SAME_PASSWORD);
    expect(same.body.error.message).toBe('新密码不能和当前密码相同');
  });

  it('omits appCode when the error has no mapped business code', async () => {
    const response = await request(app.getHttpServer())
      .get('/trpc/cards.bySlug')
      .query({ input: JSON.stringify({ slug: 'missing-session-card' }) });

    expect(response.status).toBe(404);
    expect(response.body.error.data.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toBe('卡牌不存在');
    expect(response.body.error.data).not.toHaveProperty('appCode');
    expect(JSON.stringify(response.body)).not.toContain('"appCode"');
  });

  it('rejects an oversize password with 400 and no password or parser text', async () => {
    const identity = nextIdentity('long');
    const registered = await register(app, identity);
    const oversize = 'p'.repeat(200);

    const response = await request(app.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${registered.token}`)
      .set('X-Forwarded-For', identity.ip)
      .send({ currentPassword: PASSWORD, newPassword: oversize });

    expect(response.status).toBe(400);
    expect(response.body.error.data.code).toBe('BAD_REQUEST');
    expect(response.body.error.data).not.toHaveProperty('appCode');
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(oversize);
    expect(serialized).not.toContain('is not valid JSON');
    expect(serialized).not.toContain('Unexpected token');
    expect(serialized).not.toContain('Prisma');
    expect(serialized).toContain('密码过长');
  });

  it('rejects an oversize body with 413 and a bad JSON body with 400', async () => {
    const identity = nextIdentity('body');
    const registered = await register(app, identity);
    const body = JSON.stringify({
      currentPassword: PASSWORD,
      newPassword: NEXT_PASSWORD,
      blob: 'x'.repeat(150_000),
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(100 * 1024);

    const tooLarge = await request(app.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${registered.token}`)
      .set('X-Forwarded-For', identity.ip)
      .send(body);
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
    expect(tooLarge.body.error.data).not.toHaveProperty('appCode');
    expect(JSON.stringify(tooLarge.body)).not.toContain('entity.too.large');
    expect(JSON.stringify(tooLarge.body)).not.toContain('request entity too large');

    const badJson = await request(app.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${registered.token}`)
      .set('X-Forwarded-For', identity.ip)
      .send('{"currentPassword":"TRUNC_MARKER_password"');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.data.code).toBe('BAD_REQUEST');
    expect(badJson.body.error.data).not.toHaveProperty('appCode');
    const serialized = JSON.stringify(badJson.body);
    expect(serialized).not.toContain('TRUNC_MARKER_password');
    expect(serialized).not.toContain('is not valid JSON');
    expect(serialized).not.toContain('Unexpected token');
    expect(serialized).not.toContain('SyntaxError');
  });

  it('counts one user lookup on an admin request', async () => {
    const identity = nextIdentity('admin');
    const registered = await register(app, identity);
    const prisma = app.get(PrismaService);
    await prisma.user.update({ where: { id: registered.id }, data: { role: 'admin' } });

    const findUnique = jest.spyOn(prisma.user, 'findUnique');
    findUnique.mockClear();
    try {
      const response = await request(app.getHttpServer())
        .get('/trpc/admin.series.list')
        .set('Authorization', `Bearer ${registered.token}`);
      expect(response.status).toBe(200);
      const userLookups = findUnique.mock.calls.filter((call) => {
        const args = call[0];
        return (
          typeof args === 'object' &&
          args !== null &&
          'where' in args &&
          typeof args.where === 'object' &&
          args.where !== null &&
          'id' in args.where
        );
      });
      expect(userLookups).toHaveLength(1);
      expect(userLookups[0]?.[0]).toEqual({
        where: { id: registered.id },
        select: { tokenVersion: true, role: true },
      });
    } finally {
      findUnique.mockRestore();
    }
  });
});

describe('changePassword rate limit', () => {
  let app: INestApplication;
  let limited: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    limited = await createApp({
      rateLimitOverrides: { authMutation: { limit: 1, windowMs: 60_000 } },
    });
    await app.init();
    await limited.init();
  });

  afterAll(async () => {
    await app?.close();
    await limited?.close();
  });

  it('returns TOO_MANY_REQUESTS with appCode after the login limiter', async () => {
    const identity = nextIdentity('rate');
    const registered = await register(app, identity);

    const first = await request(limited.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${registered.token}`)
      .set('X-Forwarded-For', '203.0.113.44')
      .send({ currentPassword: 'not-the-password', newPassword: NEXT_PASSWORD });
    expect(first.status).toBe(401);
    expect(first.body.error.data.appCode).toBe(APP_ERROR_CODES.WRONG_PASSWORD);

    const limitedResponse = await request(limited.getHttpServer())
      .post('/trpc/auth.changePassword')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${registered.token}`)
      .set('X-Forwarded-For', '203.0.113.44')
      .send({ currentPassword: 'not-the-password', newPassword: NEXT_PASSWORD });
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.body.error.data.code).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);
    expect(limitedResponse.body.error.data.appCode).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);
    expect(limitedResponse.body.error.data.httpStatus).toBe(429);
  });
});

describe('production error messages', () => {
  let app: INestApplication;
  const previousNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    await app?.close();
  });

  it('drops parser text from a bad JSON body when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    try {
      const response = await request(app.getHttpServer())
        .post('/trpc/auth.changePassword')
        .set('Content-Type', 'application/json')
        .send('{"currentPassword":"PROD_PARSER_MARKER"');
      expect(response.status).toBe(400);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('PROD_PARSER_MARKER');
      expect(serialized).not.toContain('is not valid JSON');
      expect(serialized).not.toContain('Unexpected token');
      expect(serialized).not.toContain('SyntaxError');
      expect(serialized).not.toContain('Prisma');
      expect(response.body.error.data).not.toHaveProperty('stack');
      expect(response.body.error.data).not.toHaveProperty('appCode');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('replaces Prisma and stack text when NODE_ENV=production', async () => {
    const identity = nextIdentity('prod');
    const registered = await register(app, identity);
    const prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('ALTER TABLE "users" DROP COLUMN "tokenVersion"');

    try {
      const leaked = await usersMe(app, registered.token);
      const leakedText = JSON.stringify(leaked.body);
      expect(leaked.status).toBeGreaterThanOrEqual(500);
      expect(leakedText).toMatch(/prisma/i);

      process.env.NODE_ENV = 'production';
      const response = await usersMe(app, registered.token);
      const serialized = JSON.stringify(response.body);
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(response.body.error.message).toBe(t('zh-CN', 'error.internal'));
      expect(serialized).not.toMatch(/prisma/i);
      expect(serialized).not.toContain('invocation');
      expect(serialized).not.toContain('node_modules');
      expect(serialized).not.toContain('tokenVersion');
      expect(serialized).not.toContain('\n');
      expect(serialized).not.toContain('at ');
      expect(response.body.error.data).not.toHaveProperty('stack');
      expect(response.body.error.data).not.toHaveProperty('appCode');
      expect(leakedText).not.toBe(serialized);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0',
      );
    }
  });
});
