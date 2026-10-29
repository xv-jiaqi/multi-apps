import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES, appErrorMessage } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { cardsListBySeriesCacheKey } from '../src/modules/redis/catalog-cache';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RedisService } from '../src/modules/redis/redis.service';

const VALIDATION = appErrorMessage('zh-CN', APP_ERROR_CODES.VALIDATION);

type FixtureCard = {
  key: string;
  name: string;
  cardNumber: string | null;
  rarity: string | null;
  subset: 'base' | 'insert';
  createdAt: string;
  attributes?: Record<string, string | number>;
  description?: string;
};

const FIXTURE: FixtureCard[] = [
  {
    key: 'empty-a',
    name: '空号甲',
    cardNumber: null,
    rarity: 'common',
    subset: 'base',
    createdAt: '2020-01-01T00:00:00.000Z',
  },
  {
    key: 'empty-b',
    name: '空号乙',
    cardNumber: '',
    rarity: null,
    subset: 'base',
    createdAt: '2020-01-02T00:00:00.000Z',
  },
  {
    key: 'promo',
    name: '宣传',
    cardNumber: 'PROMO',
    rarity: 'epic',
    subset: 'insert',
    createdAt: '2020-01-03T00:00:00.000Z',
    description: 'secret-desc-token',
  },
  {
    key: 'n12',
    name: '十二',
    cardNumber: '12/165',
    rarity: 'special',
    subset: 'base',
    createdAt: '2020-01-04T00:00:00.000Z',
  },
  {
    key: 'tg10',
    name: '训练十',
    cardNumber: 'TG10',
    rarity: 'common',
    subset: 'insert',
    createdAt: '2020-01-05T00:00:00.000Z',
    attributes: { attack: 2, lore: '边注' },
  },
  {
    key: 'sv',
    name: '特殊十',
    cardNumber: 'SV10a',
    rarity: 'rare',
    subset: 'base',
    createdAt: '2020-01-06T00:00:00.000Z',
  },
  {
    key: 'a10',
    name: '前缀十',
    cardNumber: 'A10',
    rarity: 'epic',
    subset: 'base',
    createdAt: '2020-01-07T00:00:00.000Z',
  },
  {
    key: 'n10',
    name: '卡10',
    cardNumber: '10',
    rarity: 'legendary',
    subset: 'base',
    createdAt: '2020-01-08T00:00:00.000Z',
  },
  {
    key: 'n2b',
    name: '二b',
    cardNumber: '2b',
    rarity: 'common',
    subset: 'base',
    createdAt: '2020-01-09T00:00:00.000Z',
  },
  {
    key: 'n2a',
    name: '二a',
    cardNumber: '2a',
    rarity: 'common',
    subset: 'base',
    createdAt: '2020-01-10T00:00:00.000Z',
  },
  {
    key: 'a2',
    name: '前缀二',
    cardNumber: 'A2',
    rarity: 'rare',
    subset: 'insert',
    createdAt: '2020-01-11T00:00:00.000Z',
  },
  {
    key: 'slash',
    name: '二斜',
    cardNumber: '2/165',
    rarity: 'epic',
    subset: 'base',
    createdAt: '2020-01-12T00:00:00.000Z',
  },
  {
    key: 'n2',
    name: '卡2',
    cardNumber: '2',
    rarity: 'common',
    subset: 'base',
    createdAt: '2020-01-13T00:00:00.000Z',
    attributes: { cost: 1, health: 2, type: '随从' },
  },
  {
    key: 'tg01',
    name: '训练一',
    cardNumber: 'TG01',
    rarity: 'common',
    subset: 'insert',
    createdAt: '2020-01-14T00:00:00.000Z',
  },
  {
    key: 'n1',
    name: '卡1',
    cardNumber: '1',
    rarity: 'rare',
    subset: 'base',
    createdAt: '2020-01-15T00:00:00.000Z',
  },
  {
    key: 'n001',
    name: '零一',
    cardNumber: '001',
    rarity: 'common',
    subset: 'base',
    createdAt: '2020-01-16T00:00:00.000Z',
  },
  {
    key: 'tie-b',
    name: '同名',
    cardNumber: '4',
    rarity: 'common',
    subset: 'base',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    key: 'tie-a',
    name: '同名',
    cardNumber: '4',
    rarity: 'common',
    subset: 'base',
    createdAt: '2024-01-02T00:00:00.000Z',
  },
  {
    key: 'pct',
    name: '100%',
    cardNumber: '99',
    rarity: 'common',
    subset: 'base',
    createdAt: '2024-06-01T00:00:00.000Z',
  },
];

const NUMBER_ORDER = [
  'n001',
  'n1',
  'tg01',
  'n2',
  'slash',
  'a2',
  'n2a',
  'n2b',
  'tie-a',
  'tie-b',
  'n10',
  'a10',
  'sv',
  'tg10',
  'n12',
  'pct',
  'promo',
  'empty-a',
  'empty-b',
];

const RARITY_ORDER = [
  'empty-a',
  'n001',
  'n2',
  'n2a',
  'n2b',
  'pct',
  'tg01',
  'tg10',
  'tie-a',
  'tie-b',
  'a2',
  'n1',
  'sv',
  'a10',
  'promo',
  'slash',
  'n10',
  'n12',
  'empty-b',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('expected tRPC result data');
  }
  return body.result.data;
}

type ListedCard = {
  id: string;
  slug: string;
  name: string;
  rarity: string | null;
  cardNumber: string | null;
  subsetSlug: string | null;
  attributes: Record<string, string | number | boolean | null> | null;
};

function listedCards(body: unknown): ListedCard[] {
  const items = resultData(body).items;
  if (!Array.isArray(items)) throw new Error('expected items');
  return items as ListedCard[];
}

describe('cards.listBySeries', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`.replace(/[^a-z0-9]/g, '');
  const seriesSlug = `lst-${suffix}`.slice(0, 64);
  const missingSlug = `lst-missing-${suffix}`.slice(0, 64);
  const adminEmail = `lst-admin-${suffix}@cardhub.test`;
  const adminUsername = `lst${suffix}`.slice(0, 24);
  let adminToken = '';

  const slugOf = (key: string) => `${key}-${suffix}`.slice(0, 64);
  const idOf = (key: string) => `${key}-${suffix}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const registered = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.90')
      .send({
        email: adminEmail,
        username: adminUsername,
        password: 'list-by-series-password',
      });
    expect(registered.status).toBe(200);
    const token = resultData(registered.body).token;
    if (typeof token !== 'string') throw new Error('expected token');
    adminToken = token;
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'admin' } });

    const series = await prisma.series.create({
      data: { slug: seriesSlug, title: '清单系列' },
    });
    const base = await prisma.subset.create({
      data: { seriesId: series.id, slug: 'base', name: '主卡', kind: 'BASE' },
    });
    const insert = await prisma.subset.create({
      data: { seriesId: series.id, slug: 'insert', name: '特殊卡', kind: 'INSERT', sortOrder: 1 },
    });
    await prisma.card.createMany({
      data: FIXTURE.map((card) => ({
        id: idOf(card.key),
        slug: slugOf(card.key),
        name: card.name,
        description: card.description ?? null,
        rarity: card.rarity,
        cardNumber: card.cardNumber,
        attributes: card.attributes ?? {},
        seriesId: series.id,
        subsetId: card.subset === 'base' ? base.id : insert.id,
        createdAt: new Date(card.createdAt),
      })),
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.series.deleteMany({ where: { slug: { in: [seriesSlug, missingSlug] } } });
      await prisma.user.deleteMany({ where: { email: adminEmail } });
    }
    await app?.close();
  });

  function getProcedure(path: string, input: unknown) {
    return request(app.getHttpServer())
      .get(`/trpc/${path}`)
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.91');
  }

  function keysOf(cards: ListedCard[]): string[] {
    return cards.map((card) => card.slug.slice(0, card.slug.length - suffix.length - 1));
  }

  it('filters, orders, and pages the series without changing the old series payload', async () => {
    const listed = await getProcedure('cards.listBySeries', { seriesSlug });
    expect(listed.status).toBe(200);
    const body = resultData(listed.body);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(60);
    expect(body.total).toBe(FIXTURE.length);
    expect(body.sort).toBe('number');
    const items = listedCards(listed.body);
    expect(keysOf(items)).toEqual(NUMBER_ORDER);
    expect(items.find((card) => card.slug === slugOf('tg10'))?.attributes).toEqual({
      attack: 2,
      lore: '边注',
    });
    const labels = body.attributeLabels as Record<string, { 'zh-CN': string; 'en-US': string }>;
    expect(labels.attack).toEqual({ 'zh-CN': '攻击', 'en-US': 'Attack' });
    expect(labels.cost).toEqual({ 'zh-CN': '费用', 'en-US': 'Cost' });
    expect(labels.health).toEqual({ 'zh-CN': '生命', 'en-US': 'Health' });
    expect(labels.type).toEqual({ 'zh-CN': '类型', 'en-US': 'Type' });
    expect(labels.lore).toEqual({ 'zh-CN': 'lore', 'en-US': 'lore' });
    expect(Object.keys(labels).slice(0, 4)).toEqual(['cost', 'attack', 'health', 'type']);

    const byNumber = await getProcedure('cards.listBySeries', {
      seriesSlug,
      sort: 'number',
      page: 1,
      pageSize: 2,
    });
    expect(keysOf(listedCards(byNumber.body))).toEqual(['n001', 'n1']);
    expect(resultData(byNumber.body).total).toBe(FIXTURE.length);
    const pageTwo = await getProcedure('cards.listBySeries', {
      seriesSlug,
      sort: 'number',
      page: 2,
      pageSize: 2,
    });
    expect(keysOf(listedCards(pageTwo.body))).toEqual(['tg01', 'n2']);
    const lastPage = await getProcedure('cards.listBySeries', {
      seriesSlug,
      sort: 'number',
      page: 10,
      pageSize: 2,
    });
    expect(keysOf(listedCards(lastPage.body))).toEqual(['empty-b']);
    expect(resultData(lastPage.body).total).toBe(FIXTURE.length);
    const pastEnd = await getProcedure('cards.listBySeries', {
      seriesSlug,
      sort: 'number',
      page: 11,
      pageSize: 2,
    });
    expect(listedCards(pastEnd.body)).toEqual([]);
    expect(resultData(pastEnd.body).total).toBe(FIXTURE.length);
    const wide = await getProcedure('cards.listBySeries', {
      seriesSlug,
      page: 10_000,
      pageSize: 100,
    });
    expect(listedCards(wide.body)).toEqual([]);
    expect(resultData(wide.body).page).toBe(10_000);
    expect(resultData(wide.body).pageSize).toBe(100);

    const byName = listedCards(
      (await getProcedure('cards.listBySeries', { seriesSlug, sort: 'name', pageSize: 100 })).body,
    );
    const names = byName.map((card) => card.name);
    expect(names.indexOf('卡1')).toBeLessThan(names.indexOf('卡2'));
    expect(names.indexOf('卡2')).toBeLessThan(names.indexOf('卡10'));
    const sameName = byName.filter((card) => card.name === '同名').map((card) => card.id);
    expect(sameName).toEqual([idOf('tie-a'), idOf('tie-b')]);

    const byRarity = listedCards(
      (await getProcedure('cards.listBySeries', { seriesSlug, sort: 'rarity', pageSize: 100 }))
        .body,
    );
    expect(keysOf(byRarity)).toEqual(RARITY_ORDER);

    const byCreated = listedCards(
      (await getProcedure('cards.listBySeries', { seriesSlug, sort: 'created', pageSize: 100 }))
        .body,
    );
    expect(keysOf(byCreated)).toEqual(FIXTURE.map((card) => card.key));

    const baseOnly = listedCards(
      (await getProcedure('cards.listBySeries', { seriesSlug, subsetSlug: 'base', pageSize: 100 }))
        .body,
    );
    expect(baseOnly).toHaveLength(15);
    expect(baseOnly.every((card) => card.subsetSlug === 'base')).toBe(true);
    const rareOnly = listedCards(
      (await getProcedure('cards.listBySeries', { seriesSlug, rarity: 'legendary', pageSize: 100 }))
        .body,
    );
    expect(rareOnly.map((card) => card.slug)).toEqual([slugOf('n10')]);
    const combined = listedCards(
      (
        await getProcedure('cards.listBySeries', {
          seriesSlug,
          subsetSlug: 'base',
          rarity: 'legendary',
          q: '卡10',
        })
      ).body,
    );
    expect(combined.map((card) => card.slug)).toEqual([slugOf('n10')]);
    const byNumberQuery = listedCards(
      (await getProcedure('cards.listBySeries', { seriesSlug, q: 'tg0' })).body,
    );
    expect(byNumberQuery.map((card) => card.slug)).toEqual([slugOf('tg01')]);
    const description = await getProcedure('cards.listBySeries', {
      seriesSlug,
      q: 'secret-desc-token',
    });
    expect(resultData(description.body).total).toBe(0);
    const percent = listedCards(
      (await getProcedure('cards.listBySeries', { seriesSlug, q: '%' })).body,
    );
    expect(percent.map((card) => card.slug)).toEqual([slugOf('pct')]);
    const underscore = await getProcedure('cards.listBySeries', { seriesSlug, q: '_' });
    expect(resultData(underscore.body).total).toBe(0);
    const literalPercent = listedCards(
      (await getProcedure('cards.listBySeries', { seriesSlug, q: '100%' })).body,
    );
    expect(literalPercent.map((card) => card.slug)).toEqual([slugOf('pct')]);
    const unknownSubset = await getProcedure('cards.listBySeries', {
      seriesSlug,
      subsetSlug: 'missing-subset',
    });
    expect(unknownSubset.status).toBe(200);
    expect(resultData(unknownSubset.body).total).toBe(0);
    const extraField = await getProcedure('cards.listBySeries', { seriesSlug, foo: 1 });
    expect(extraField.status).toBe(200);
    expect(resultData(extraField.body).total).toBe(FIXTURE.length);

    const legacy = await getProcedure('series.bySlug', { slug: seriesSlug });
    expect(legacy.status).toBe(200);
    const legacyBody = resultData(legacy.body);
    expect(legacyBody).not.toHaveProperty('attributeLabels');
    const legacyCards = legacyBody.cards as Array<{ slug: string }>;
    expect(legacyCards).toHaveLength(FIXTURE.length);
    expect(legacyCards[0]?.slug).toBe(slugOf('empty-a'));
    expect(legacyCards.map((card) => card.slug)).not.toEqual(items.map((card) => card.slug));
    const detail = await getProcedure('cards.bySlug', { slug: slugOf('n2') });
    expect(detail.status).toBe(200);
    const detailBody = resultData(detail.body);
    expect(detailBody).not.toHaveProperty('attributeLabels');
    expect(detailBody.attributes).toEqual({ cost: 1, health: 2, type: '随从' });
    const searched = await getProcedure('cards.search', {
      q: '卡10',
      limit: 5,
      seriesSlug,
    });
    expect(searched.status).toBe(200);
    expect(JSON.stringify(resultData(searched.body).results)).toContain(slugOf('n10'));

    const redis = app.get(RedisService);
    const fullKey = cardsListBySeriesCacheKey({ seriesSlug });
    const keywordKey = cardsListBySeriesCacheKey({ seriesSlug, q: '卡10' });
    expect(fullKey).not.toBe(keywordKey);
    expect(fullKey).toContain(`series=${seriesSlug}&`);
    expect(fullKey).toContain('q=&rarity=&subset=&sort=number&page=1&pageSize=60');
    expect(keywordKey).toContain(`q=${encodeURIComponent('卡10')}`);
    expect(await redis.client.get(fullKey)).toContain('卡10');
    const ttl = await redis.client.ttl(fullKey);
    expect(ttl).toBeGreaterThan(240);
    expect(ttl).toBeLessThanOrEqual(300);

    await prisma.card.update({ where: { slug: slugOf('n10') }, data: { name: '库内改名' } });
    const cached = listedCards((await getProcedure('cards.listBySeries', { seriesSlug })).body);
    expect(cached.some((card) => card.name === '卡10')).toBe(true);
    expect(cached.some((card) => card.name === '库内改名')).toBe(false);
    const cachedDefaults = listedCards(
      (
        await getProcedure('cards.listBySeries', {
          seriesSlug,
          sort: 'number',
          page: 1,
          pageSize: 60,
        })
      ).body,
    );
    expect(cachedDefaults.some((card) => card.name === '库内改名')).toBe(false);
    const cachedBlank = listedCards(
      (await getProcedure('cards.listBySeries', { seriesSlug, q: '   ' })).body,
    );
    expect(cachedBlank.some((card) => card.name === '库内改名')).toBe(false);
    const freshQuery = await getProcedure('cards.listBySeries', { seriesSlug, q: '库内改名' });
    expect(listedCards(freshQuery.body).map((card) => card.slug)).toEqual([slugOf('n10')]);
    const ampersandKey = cardsListBySeriesCacheKey({ seriesSlug, q: 'a&b' });
    expect(ampersandKey).toContain('q=a%26b');
    expect(ampersandKey).not.toContain('q=a&b');
    await getProcedure('cards.listBySeries', { seriesSlug, q: 'a&b' });
    expect(await redis.client.get(ampersandKey)).toBeTruthy();

    const updated = await request(app.getHttpServer())
      .post('/trpc/admin.cards.update')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', '203.0.113.92')
      .send({
        slug: slugOf('n10'),
        name: '后台改名',
        rarity: 'legendary',
        attributes: {},
        seriesSlug,
      });
    expect(updated.status).toBe(200);
    const fresh = listedCards((await getProcedure('cards.listBySeries', { seriesSlug })).body);
    expect(fresh.some((card) => card.name === '后台改名')).toBe(true);
    expect(fresh.some((card) => card.name === '卡10')).toBe(false);
    const legacyFresh = await getProcedure('series.bySlug', { slug: seriesSlug });
    expect(JSON.stringify(resultData(legacyFresh.body).cards)).toContain('后台改名');
  });

  it('returns NOT_FOUND for a missing series and does not cache that miss', async () => {
    const missing = await getProcedure('cards.listBySeries', { seriesSlug: missingSlug });
    expect(missing.status).toBe(404);
    expect(missing.body.error.data.code).toBe('NOT_FOUND');
    expect(missing.body.error.data.appCode).toBe(APP_ERROR_CODES.NOT_FOUND);
    expect(missing.body.error.message).toBe('系列不存在');
    expect(JSON.stringify(missing.body)).not.toContain('prisma');

    await prisma.series.create({ data: { slug: missingSlug, title: '后补系列' } });
    const created = await getProcedure('cards.listBySeries', { seriesSlug: missingSlug });
    expect(created.status).toBe(200);
    expect(resultData(created.body).total).toBe(0);
    expect(listedCards(created.body)).toEqual([]);
  });

  it('rejects illegal input with the existing validation code', async () => {
    const cases: Array<{ input: Record<string, unknown>; path: string; message: string }> = [
      { input: { seriesSlug, page: 0 }, path: 'page', message: 'too_small' },
      { input: { seriesSlug, page: 1.5 }, path: 'page', message: 'invalid_type' },
      { input: { seriesSlug, page: '1' }, path: 'page', message: 'invalid_type' },
      { input: { seriesSlug, page: 10_001 }, path: 'page', message: 'too_big' },
      { input: { seriesSlug, pageSize: 0 }, path: 'pageSize', message: 'too_small' },
      { input: { seriesSlug, pageSize: 101 }, path: 'pageSize', message: 'too_big' },
      { input: { seriesSlug, rarity: 'mythic' }, path: 'rarity', message: 'invalid_value' },
      { input: { seriesSlug, sort: 'id' }, path: 'sort', message: 'invalid_value' },
      { input: { seriesSlug: 'Not A Slug' }, path: 'seriesSlug', message: 'slug_format' },
      { input: { seriesSlug, subsetSlug: 'Not' }, path: 'subsetSlug', message: 'slug_format' },
      { input: { seriesSlug, q: 'x'.repeat(201) }, path: 'q', message: 'too_big' },
      { input: { seriesSlug, q: null }, path: 'q', message: 'invalid_type' },
      { input: {}, path: 'seriesSlug', message: 'invalid_type' },
    ];

    for (const sample of cases) {
      const response = await getProcedure('cards.listBySeries', sample.input);
      expect(response.status).toBe(400);
      expect(response.body.error.data.code).toBe('BAD_REQUEST');
      expect(response.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);
      expect(response.body.error.message).toBe(VALIDATION);
      const issues = response.body.error.data.zodError.issues as Array<{
        path: Array<string | number>;
        message: string;
      }>;
      const issue = issues.find((item) => item.path[0] === sample.path);
      expect(issue?.message).toBe(sample.message);
      expect(issue?.message).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('ZodError');
      expect(serialized).not.toContain('Invalid input');
      expect(serialized).not.toContain('Too big');
      expect(serialized).not.toContain('Too small');
    }
  });
});
