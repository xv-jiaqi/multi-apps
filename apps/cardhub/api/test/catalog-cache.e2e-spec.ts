import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { cardBySlugKey } from '../src/modules/redis/catalog-cache';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RedisService } from '../src/modules/redis/redis.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('expected tRPC result data');
  }
  return body.result.data;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`expected ${label}`);
  return value;
}

describe('catalog cache', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let deadApp: INestApplication | undefined;
  let prisma: PrismaService;
  const suffix = `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`.replace(/[^a-z0-9]/gi, '');
  const seriesSlug = `cache-series-${suffix}`.slice(0, 64);
  const cardSlug = `cache-card-${suffix}`.slice(0, 64);
  const categorySlug = `cache-cat-${suffix}`.slice(0, 64);
  const missingSlug = `cache-missing-${suffix}`.slice(0, 64);
  const adminEmail = `cache-admin-${suffix}@cardhub.test`;
  const adminUsername = `cadm${suffix}`.slice(0, 24);
  let adminToken = '';

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const registered = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.70')
      .send({
        email: adminEmail,
        username: adminUsername,
        password: 'cache-password',
      });
    expect(registered.status).toBe(200);
    adminToken = readString(resultData(registered.body).token, 'token');
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'admin' } });

    await prisma.category.create({
      data: { slug: categorySlug, name: '缓存品类' },
    });
    const series = await prisma.series.create({
      data: {
        slug: seriesSlug,
        title: '缓存系列',
        category: { connect: { slug: categorySlug } },
      },
    });
    await prisma.card.create({
      data: { slug: cardSlug, name: '缓存卡', seriesId: series.id, rarity: 'rare' },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.card.deleteMany({ where: { slug: { in: [cardSlug, missingSlug] } } });
      await prisma.series.deleteMany({ where: { slug: seriesSlug } });
      await prisma.category.deleteMany({ where: { slug: categorySlug } });
      await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
    }
    await deadApp?.close();
    await app?.close();
  });

  function getProcedure(target: INestApplication, path: string, input: unknown) {
    return request(target.getHttpServer())
      .get(`/trpc/${path}`)
      .query({ input: JSON.stringify(input) });
  }

  it('serves cards.bySlug and series.bySlug from cache until an admin edit', async () => {
    const firstCard = await getProcedure(app, 'cards.bySlug', { slug: cardSlug });
    const firstSeries = await getProcedure(app, 'series.bySlug', { slug: seriesSlug });
    expect(firstCard.status).toBe(200);
    expect(readString(resultData(firstCard.body).name, 'name')).toBe('缓存卡');
    const firstCards = resultData(firstSeries.body).cards;
    expect(Array.isArray(firstCards)).toBe(true);

    await prisma.card.update({ where: { slug: cardSlug }, data: { name: '绕过后台' } });

    const cachedCard = await getProcedure(app, 'cards.bySlug', { slug: cardSlug });
    const cachedSeries = await getProcedure(app, 'series.bySlug', { slug: seriesSlug });
    expect(readString(resultData(cachedCard.body).name, 'name')).toBe('缓存卡');
    expect(JSON.stringify(resultData(cachedSeries.body).cards)).toContain('缓存卡');
    expect(JSON.stringify(resultData(cachedSeries.body).cards)).not.toContain('绕过后台');

    const ttl = await app.get(RedisService).client.ttl(cardBySlugKey(cardSlug));
    expect(ttl).toBeGreaterThan(240);
    expect(ttl).toBeLessThanOrEqual(300);

    const updated = await request(app.getHttpServer())
      .post('/trpc/admin.cards.update')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', '203.0.113.71')
      .send({
        slug: cardSlug,
        name: '后台改过',
        rarity: 'rare',
        attributes: {},
        seriesSlug,
      });
    expect(updated.status).toBe(200);

    const freshCard = await getProcedure(app, 'cards.bySlug', { slug: cardSlug });
    const freshSeries = await getProcedure(app, 'series.bySlug', { slug: seriesSlug });
    expect(freshCard.status).toBe(200);
    expect(readString(resultData(freshCard.body).name, 'name')).toBe('后台改过');
    expect(JSON.stringify(resultData(freshSeries.body).cards)).toContain('后台改过');
  });

  it('does not cache a missing card', async () => {
    const missing = await getProcedure(app, 'cards.bySlug', { slug: missingSlug });
    expect(missing.status).toBe(404);

    const series = await prisma.series.findUnique({ where: { slug: seriesSlug } });
    if (!series) throw new Error('series missing');
    await prisma.card.create({
      data: { slug: missingSlug, name: '后来补上', seriesId: series.id },
    });

    const created = await getProcedure(app, 'cards.bySlug', { slug: missingSlug });
    expect(created.status).toBe(200);
    expect(readString(resultData(created.body).name, 'name')).toBe('后来补上');
  });

  it('refreshes series.list and category reads after the matching admin write', async () => {
    const listed = await getProcedure(app, 'series.list', { page: 1, pageSize: 100 });
    const category = await getProcedure(app, 'categories.bySlug', { slug: categorySlug });
    const categories = await getProcedure(app, 'categories.list', {});
    expect(listed.status).toBe(200);
    expect(JSON.stringify(resultData(listed.body).items)).toContain('缓存系列');
    expect(readString(resultData(category.body).name, 'category')).toBe('缓存品类');
    expect(JSON.stringify(resultData(categories.body).items)).toContain('缓存品类');

    await prisma.series.update({ where: { slug: seriesSlug }, data: { title: '库里的系列名' } });
    await prisma.category.update({
      where: { slug: categorySlug },
      data: { name: '库里的品类名' },
    });

    const cachedList = await getProcedure(app, 'series.list', { page: 1, pageSize: 100 });
    const cachedCategory = await getProcedure(app, 'categories.bySlug', { slug: categorySlug });
    expect(JSON.stringify(resultData(cachedList.body).items)).toContain('缓存系列');
    expect(JSON.stringify(resultData(cachedList.body).items)).not.toContain('库里的系列名');
    expect(readString(resultData(cachedCategory.body).name, 'category')).toBe('缓存品类');

    const seriesWrite = await request(app.getHttpServer())
      .post('/trpc/admin.series.update')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', '203.0.113.72')
      .send({ slug: seriesSlug, title: '后台系列' });
    expect(seriesWrite.status).toBe(200);
    const categoryWrite = await request(app.getHttpServer())
      .post('/trpc/admin.categories.update')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', '203.0.113.73')
      .send({ slug: categorySlug, name: '后台品类' });
    expect(categoryWrite.status).toBe(200);

    const freshList = await getProcedure(app, 'series.list', { page: 1, pageSize: 100 });
    const freshCategory = await getProcedure(app, 'categories.bySlug', { slug: categorySlug });
    const freshCategories = await getProcedure(app, 'categories.list', {});
    expect(JSON.stringify(resultData(freshList.body).items)).toContain('后台系列');
    expect(readString(resultData(freshCategory.body).name, 'category')).toBe('后台品类');
    expect(JSON.stringify(resultData(freshCategories.body).items)).toContain('后台品类');
  });

  it('still returns 200 for a cached read and a rate-limited register when Redis is down', async () => {
    const previousHost = process.env.REDIS_HOST;
    const previousPort = process.env.REDIS_PORT;
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6390';
    try {
      deadApp = await createApp({
        rateLimitOverrides: { authMutation: { limit: 1, windowMs: 60_000 } },
      });
      await deadApp.init();

      const card = await getProcedure(deadApp, 'cards.bySlug', { slug: cardSlug });
      expect(card.status).toBe(200);
      expect(readString(resultData(card.body).name, 'name')).toBe('后台改过');

      for (let i = 0; i < 3; i += 1) {
        const registered = await request(deadApp.getHttpServer())
          .post('/trpc/auth.register')
          .set('Content-Type', 'application/json')
          .set('X-Forwarded-For', '203.0.113.74')
          .send({
            email: `cache-open-${suffix}-${i}@cardhub.test`,
            username: `copen${suffix}${i}`.slice(0, 24),
            password: 'cache-password',
          });
        expect(registered.status).toBe(200);
      }
    } finally {
      if (previousHost === undefined) delete process.env.REDIS_HOST;
      else process.env.REDIS_HOST = previousHost;
      if (previousPort === undefined) delete process.env.REDIS_PORT;
      else process.env.REDIS_PORT = previousPort;
    }
  });
});
