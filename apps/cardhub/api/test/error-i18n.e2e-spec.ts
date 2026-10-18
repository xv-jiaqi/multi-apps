import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { APP_ERROR_CODES, t } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
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

  it('login failure returns UNAUTHORIZED', async () => {
    const response = await post('auth.login', { identifier: username, password: 'wrong-password' });
    expectAppCode(response, 401, APP_ERROR_CODES.UNAUTHORIZED, 'UNAUTHORIZED');
    expect(response.body.error.message).toBe('用户名或密码错误');
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
