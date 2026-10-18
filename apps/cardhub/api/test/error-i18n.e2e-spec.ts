import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { APP_ERROR_CODES, t } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { hashPassword } from '../src/modules/auth/password-hash';
import { PrismaService } from '../src/modules/prisma/prisma.service';

function resultData(body: { result?: { data?: unknown } }): Record<string, unknown> {
  const data = body.result?.data;
  if (typeof data !== 'object' || data === null) {
    throw new Error('expected a result object');
  }
  return data as Record<string, unknown>;
}

describe('localized API error codes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
  const email = `err-${suffix}@cardhub.test`;
  const username = `u${suffix}`.slice(0, 24);
  const password = 'correct-horse';
  let token = '';
  let cardSlug = '';

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const series = await prisma.series.create({
      data: { slug: `ser-${suffix}`.slice(0, 64), title: '错误码系列' },
    });
    const card = await prisma.card.create({
      data: { slug: `card-${suffix}`.slice(0, 64), name: '错误码卡', seriesId: series.id },
    });
    cardSlug = card.slug;
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(path: string, body: unknown, auth?: string) {
    const req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '198.51.100.40');
    if (auth) req.set('Authorization', `Bearer ${auth}`);
    return req.send(body);
  }

  function expectAppCode(
    response: request.Response,
    status: number,
    appCode: string,
    trpcCode: string,
  ) {
    expect(response.status).toBe(status);
    expect(response.body.error.data.appCode).toBe(appCode);
    expect(response.body.error.data.code).toBe(trpcCode);
    expect(response.body.error.data).toEqual(
      expect.objectContaining({ appCode, code: trpcCode, httpStatus: status }),
    );
  }

  it('register conflict returns CONFLICT', async () => {
    const created = await post('auth.register', { email, username, password });
    expect(created.status).toBe(200);
    token = String(resultData(created.body).token);

    const conflict = await post('auth.register', {
      email,
      username: `o${suffix}`.slice(0, 24),
      password,
    });
    expectAppCode(conflict, 409, APP_ERROR_CODES.CONFLICT, 'CONFLICT');
    expect(conflict.body.error.message).toBe('该邮箱已被注册');
  });

  it('login failure returns INVALID_CREDENTIALS, not UNAUTHORIZED', async () => {
    const unknownUser = await post('auth.login', {
      identifier: `missing-${suffix}`,
      password: 'wrong-password',
    });
    expectAppCode(unknownUser, 401, APP_ERROR_CODES.INVALID_CREDENTIALS, 'UNAUTHORIZED');
    expect(unknownUser.body.error.data.appCode).not.toBe(APP_ERROR_CODES.UNAUTHORIZED);
    expect(unknownUser.body.error.message).toBe('用户名或密码错误');

    const legacyName = `l${suffix}`.slice(0, 24);
    const legacyHash = await bcrypt.hash('legacy-secret', 4);
    expect(legacyHash.startsWith('sha256$')).toBe(false);
    await prisma.user.create({
      data: {
        email: `leg-${suffix}@cardhub.test`,
        username: legacyName,
        password: legacyHash,
      },
    });
    const legacyWrong = await post('auth.login', {
      identifier: legacyName,
      password: 'wrong-password',
    });
    expectAppCode(legacyWrong, 401, APP_ERROR_CODES.INVALID_CREDENTIALS, 'UNAUTHORIZED');
    expect(legacyWrong.body.error.data.appCode).not.toBe(APP_ERROR_CODES.UNAUTHORIZED);
    expect(legacyWrong.body.error.message).toBe('用户名或密码错误');

    const newName = `n${suffix}`.slice(0, 24);
    const newHash = await hashPassword('new-secret', { prehash: true });
    expect(newHash.startsWith('sha256$')).toBe(true);
    await prisma.user.create({
      data: {
        email: `new-${suffix}@cardhub.test`,
        username: newName,
        password: newHash,
      },
    });
    const newWrong = await post('auth.login', {
      identifier: newName,
      password: 'wrong-password',
    });
    expectAppCode(newWrong, 401, APP_ERROR_CODES.INVALID_CREDENTIALS, 'UNAUTHORIZED');
    expect(newWrong.body.error.data.appCode).not.toBe(APP_ERROR_CODES.UNAUTHORIZED);
    expect(newWrong.body.error.message).toBe('用户名或密码错误');
  });

  it('comment zod failure returns VALIDATION', async () => {
    const response = await post('comments.create', { cardSlug, content: '' }, token);
    expectAppCode(response, 400, APP_ERROR_CODES.VALIDATION, 'BAD_REQUEST');
    expect(JSON.stringify(response.body)).not.toContain('INTERNAL_SERVER_ERROR');
  });

  it('comment server failure returns INTERNAL_SERVER_ERROR and hides internals in production', async () => {
    const spy = jest
      .spyOn(prisma.comment, 'create')
      .mockRejectedValueOnce(new Error('RAW_SERVER_Prisma_boom'));
    const response = await post('comments.create', { cardSlug, content: '一条评论' }, token);
    spy.mockRestore();
    expectAppCode(response, 500, APP_ERROR_CODES.INTERNAL_SERVER_ERROR, 'INTERNAL_SERVER_ERROR');

    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const again = jest
      .spyOn(prisma.comment, 'create')
      .mockRejectedValueOnce(new Error('RAW_SERVER_Prisma_boom\n    at parser'));
    try {
      const hidden = await post('comments.create', { cardSlug, content: '另一条评论' }, token);
      expectAppCode(hidden, 500, APP_ERROR_CODES.INTERNAL_SERVER_ERROR, 'INTERNAL_SERVER_ERROR');
      expect(hidden.body.error.message).toBe(t('zh-CN', 'error.internal'));
      expect(JSON.stringify(hidden.body)).not.toContain('RAW_SERVER');
      expect(JSON.stringify(hidden.body)).not.toContain('Prisma');
      expect(hidden.body.error.data.stack).toBeUndefined();
    } finally {
      again.mockRestore();
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it.each([
    'connect ECONNREFUSED 172.18.0.4:6379',
    'getaddrinfo ENOTFOUND redis.internal',
    'Reached the max retries per request limit',
  ])('hides %s on a production 500', async (internalText) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const spy = jest.spyOn(prisma.comment, 'create').mockRejectedValueOnce(new Error(internalText));
    try {
      const response = await post('comments.create', { cardSlug, content: '一条评论' }, token);
      const serialized = JSON.stringify(response.body);
      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe(t('zh-CN', 'error.internal'));
      expect(serialized).not.toContain(internalText);
      expect(serialized).not.toContain('ECONNREFUSED');
      expect(serialized).not.toContain('ENOTFOUND');
      expect(serialized).not.toContain('172.18.0.4');
      expect(serialized).not.toContain('6379');
      expect(serialized).not.toContain('ioredis');
      expect(response.body.error.data.stack).toBeUndefined();
    } finally {
      spy.mockRestore();
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('forum topic zod failure returns VALIDATION', async () => {
    const response = await post('forum.topics.create', { title: '', body: '正文足够长' }, token);
    expectAppCode(response, 400, APP_ERROR_CODES.VALIDATION, 'BAD_REQUEST');
  });

  it('listing publish zod failure returns VALIDATION', async () => {
    const response = await post(
      'listings.publish',
      { cardSlug: 'Bad Slug', kind: 'SELL', contact: 'wechat' },
      token,
    );
    expectAppCode(response, 400, APP_ERROR_CODES.VALIDATION, 'BAD_REQUEST');
  });

  it('report zod failure returns VALIDATION', async () => {
    const response = await post(
      'reports.create',
      {
        targetType: 'COMMENT',
        targetId: '00000000-0000-4000-8000-000000000099',
        reason: 'no',
      },
      token,
    );
    expectAppCode(response, 400, APP_ERROR_CODES.VALIDATION, 'BAD_REQUEST');
  });

  it('admin import zod failure returns VALIDATION', async () => {
    const user = resultData(
      (
        await post('auth.register', {
          email: `adm-${suffix}@cardhub.test`,
          username: `a${suffix}`.slice(0, 24),
          password,
        })
      ).body,
    );
    const admin = user.user as { id: string };
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } });
    const adminToken = String(user.token);
    const response = await post('admin.catalog.import', { dryRun: 'nope' }, adminToken);
    expectAppCode(response, 400, APP_ERROR_CODES.VALIDATION, 'BAD_REQUEST');
  });
});
