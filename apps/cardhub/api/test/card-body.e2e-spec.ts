import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES, CARD_BODY_MAX, appErrorMessage } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const VALIDATION = appErrorMessage('zh-CN', APP_ERROR_CODES.VALIDATION);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('expected tRPC result data');
  }
  return body.result.data;
}

function assertNoInternalText(body: unknown): void {
  let serialized = JSON.stringify(body);
  if (isRecord(body) && isRecord(body.error) && isRecord(body.error.data)) {
    const data = { ...body.error.data };
    delete data.stack;
    serialized = JSON.stringify({ ...body, error: { ...body.error, data } });
  }
  expect(serialized).not.toContain('ZodError');
  expect(serialized).not.toContain('Prisma');
  expect(serialized).not.toContain('invocation');
  expect(serialized).not.toContain('Unexpected token');
  expect(serialized).not.toContain('is not valid JSON');
  expect(serialized).not.toContain('SyntaxError');
  expect(serialized).not.toContain('node_modules');
  expect(serialized).not.toContain('entity.too.large');
  expect(serialized).not.toContain('BODY_BAD_JSON');
}

describe('card body', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const seriesSlug = `body-set-${suffix}`;
  const cardSlug = `body-card-${suffix}`;
  const adminEmail = `body-admin-${suffix}@cardhub.test`;
  let adminToken = '';

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const registered = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.180')
      .send({
        email: adminEmail,
        username: `body${suffix}`.slice(0, 24),
        password: 'body-password',
      });
    expect(registered.status).toBe(200);
    const token = resultData(registered.body).token;
    if (typeof token !== 'string') throw new Error('expected token');
    adminToken = token;
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'admin' } });
    const series = await post('admin.series.create', { slug: seriesSlug, title: '长描述系列' });
    expect(series.status).toBe(200);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.card.deleteMany({ where: { slug: cardSlug } });
      await prisma.series.deleteMany({ where: { slug: seriesSlug } });
      await prisma.user.deleteMany({ where: { email: adminEmail } });
    }
    await app?.close();
  });

  function post(path: string, body: unknown, ip = '203.0.113.181') {
    return request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', ip)
      .send(body);
  }

  function get(path: string, input: unknown) {
    const req = request(app.getHttpServer())
      .get(`/trpc/${path}`)
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.182');
    return path.startsWith('admin.') ? req.set('Authorization', `Bearer ${adminToken}`) : req;
  }

  const cardInput = (extra: Record<string, unknown> = {}) => ({
    slug: cardSlug,
    name: '长描述卡',
    rarity: 'common',
    attributes: {},
    seriesSlug,
    ...extra,
  });

  it('writes markdown, reads it back, and leaves it when a later update omits body', async () => {
    const markdown = '## 说明\n\n一段 **Markdown**';
    const created = await post('admin.cards.create', cardInput({ body: `  ${markdown}  ` }));
    expect(created.status).toBe(200);
    expect(resultData(created.body).body).toBe(markdown);

    const adminRead = await get('admin.cards.get', { slug: cardSlug });
    expect(adminRead.status).toBe(200);
    expect(resultData(adminRead.body).body).toBe(markdown);

    const publicRead = await get('cards.bySlug', { slug: cardSlug });
    expect(publicRead.status).toBe(200);
    expect(resultData(publicRead.body).body).toBe(markdown);
    expect(await prisma.card.findUnique({ where: { slug: cardSlug } })).toMatchObject({
      body: markdown,
    });

    const listed = await get('cards.listBySeries', { seriesSlug });
    expect(listed.status).toBe(200);
    const items = resultData(listed.body).items;
    expect(Array.isArray(items)).toBe(true);
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ slug: cardSlug })]));
    for (const item of items as unknown[]) {
      expect(isRecord(item) && !('body' in item)).toBe(true);
    }

    const renamed = await post('admin.cards.update', cardInput({ name: '改名' }));
    expect(renamed.status).toBe(200);
    expect(resultData(renamed.body).name).toBe('改名');
    expect(resultData(renamed.body).body).toBe(markdown);

    const cleared = await post('admin.cards.update', cardInput({ name: '改名', body: '   ' }));
    expect(cleared.status).toBe(200);
    expect(resultData(cleared.body).body).toBeNull();
    expect((await prisma.card.findUnique({ where: { slug: cardSlug } }))?.body).toBeNull();

    await post('admin.cards.update', cardInput({ name: '改名', body: markdown }));
    const nulled = await post('admin.cards.update', cardInput({ name: '改名', body: null }));
    expect(nulled.status).toBe(200);
    expect(resultData(nulled.body).body).toBeNull();
    const publicAfter = await get('cards.bySlug', { slug: cardSlug });
    expect(resultData(publicAfter.body).body).toBeNull();
  });

  it('keeps the body column out of search and import preview card queries', async () => {
    const findName = `bodyfind${suffix}`;
    await prisma.card.update({
      where: { slug: cardSlug },
      data: { name: findName, body: '不应出现在列表查询里' },
    });
    const spy = jest.spyOn(prisma.card, 'findMany');
    try {
      const search = await get('cards.search', { q: findName });
      expect(search.status).toBe(200);
      const global = await get('search.global', { q: findName });
      expect(global.status).toBe(200);
      const preview = await post('admin.catalog.import', {
        dryRun: true,
        data: [
          {
            slug: seriesSlug,
            title: '长描述系列',
            cards: [{ slug: cardSlug, name: findName, rarity: 'common', attributes: {} }],
          },
        ],
      });
      expect(preview.status).toBe(200);

      const searchCards = resultData(search.body).results as Array<{ slug: string }>;
      const globalCards = resultData(global.body).cards as Array<{ slug: string }>;
      expect(searchCards.map((card) => card.slug)).toContain(cardSlug);
      expect(globalCards.map((card) => card.slug)).toContain(cardSlug);
      for (const card of [...searchCards, ...globalCards]) expect(card).not.toHaveProperty('body');

      const calls = spy.mock.calls.map(([args]) => args as { where?: unknown; omit?: unknown });
      expect(calls.length).toBeGreaterThanOrEqual(3);
      for (const args of calls) expect(args.omit).toEqual({ body: true });
      const rows = await Promise.all(spy.mock.results.map((result) => result.value));
      for (const row of rows.flat()) expect(row).not.toHaveProperty('body');
    } finally {
      spy.mockRestore();
      await prisma.card.update({ where: { slug: cardSlug }, data: { name: '改名', body: null } });
    }
  });

  it('rejects a body over 20000 characters without writing it', async () => {
    const tooLong = await post(
      'admin.cards.update',
      cardInput({ name: '改名', body: '卡'.repeat(CARD_BODY_MAX + 1) }),
    );
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.message).toBe(VALIDATION);
    expect(tooLong.body.error.data.zodError.fieldErrors.body).toEqual(['card_body_too_long']);
    assertNoInternalText(tooLong.body);
    expect((await prisma.card.findUnique({ where: { slug: cardSlug } }))?.body).toBeNull();

    const exact = await post(
      'admin.cards.update',
      cardInput({ name: '改名', body: '字'.repeat(CARD_BODY_MAX) }),
    );
    expect(exact.status).toBe(200);
    expect(resultData(exact.body).body).toHaveLength(CARD_BODY_MAX);
  });

  it('rejects bad JSON with 400 and an oversized request with 413', async () => {
    const badJson = await request(app.getHttpServer())
      .post('/trpc/admin.cards.update')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.183')
      .send('{"slug":"BODY_BAD_JSON');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.data.code).toBe('BAD_REQUEST');
    expect(badJson.body.error.data.appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
    assertNoInternalText(badJson.body);

    const huge = JSON.stringify(cardInput({ body: 'x'.repeat(120_000) }));
    expect(Buffer.byteLength(huge)).toBeGreaterThan(100 * 1024);
    const tooLarge = await request(app.getHttpServer())
      .post('/trpc/admin.cards.update')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', '203.0.113.184')
      .send(huge);
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
    expect(tooLarge.body.error.data.httpStatus).toBe(413);
    assertNoInternalText(tooLarge.body);
    expect((await prisma.card.findUnique({ where: { slug: cardSlug } }))?.body).toHaveLength(
      CARD_BODY_MAX,
    );
  });
});
