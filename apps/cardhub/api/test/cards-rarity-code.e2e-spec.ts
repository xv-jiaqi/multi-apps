import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES, appErrorMessage } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { cardsListBySeriesCacheKey } from '../src/modules/redis/catalog-cache';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RedisService } from '../src/modules/redis/redis.service';

const VALIDATION = appErrorMessage('zh-CN', APP_ERROR_CODES.VALIDATION);

type SubsetKey = 'main' | 'secret' | 'special' | 'energy';

/**
 * `ptcg-sc-30th` (176 cards) as run lengths in printed-number order:
 * [count, subset, attributes.稀有度, rarity]. Taken from
 * `/workspace/cardhub/data/ptcg-sc/ptcg-sc-30th.json` on 11-17.
 */
const RUNS: Array<[number, SubsetKey, string, string]> = [
  [6, 'main', 'C', 'common'],
  [2, 'main', 'R', 'rare'],
  [1, 'main', 'RR', 'rare'],
  [3, 'main', 'C', 'common'],
  [2, 'main', 'R', 'rare'],
  [1, 'main', 'RR', 'rare'],
  [1, 'main', 'C', 'common'],
  [30, 'main', '无标记', 'common'],
  [2, 'main', 'RR', 'rare'],
  [1, 'main', 'C', 'common'],
  [1, 'main', 'R', 'rare'],
  [2, 'main', 'C', 'common'],
  [2, 'main', 'R', 'rare'],
  [1, 'main', 'RR', 'rare'],
  [1, 'main', 'R', 'rare'],
  [1, 'main', 'RR', 'rare'],
  [1, 'main', 'C', 'common'],
  [1, 'main', 'RR', 'rare'],
  [3, 'main', 'C', 'common'],
  [1, 'main', 'R', 'rare'],
  [2, 'main', 'C', 'common'],
  [1, 'main', 'R', 'rare'],
  [1, 'main', 'C', 'common'],
  [1, 'main', 'R', 'rare'],
  [3, 'main', 'C', 'common'],
  [1, 'main', 'R', 'rare'],
  [3, 'main', 'C', 'common'],
  [1, 'main', 'RR', 'rare'],
  [2, 'main', 'C', 'common'],
  [1, 'main', 'R', 'rare'],
  [1, 'main', 'C', 'common'],
  [1, 'main', 'RR', 'rare'],
  [1, 'main', 'R', 'rare'],
  [1, 'main', 'C', 'common'],
  [3, 'main', 'R', 'rare'],
  [1, 'main', 'C', 'common'],
  [1, 'main', 'RR', 'rare'],
  [8, 'main', 'C', 'common'],
  [1, 'main', 'R', 'rare'],
  [6, 'main', 'C', 'common'],
  [20, 'secret', 'AR', 'epic'],
  [10, 'secret', 'SAR', 'legendary'],
  [2, 'secret', 'FUR', 'legendary'],
  [30, 'secret', '无标记', 'common'],
];
const LETTERED: Array<[string, SubsetKey]> = [
  ['R', 'special'],
  ['G', 'special'],
  ['B', 'special'],
  ...['GRA', 'FIR', 'WAT', 'LIG', 'PSY', 'FIG', 'DAR', 'MET'].map((value): [string, SubsetKey] => [
    value,
    'energy',
  ]),
];
const THIRTIETH_CODES = ['C', 'R', 'RR', '无标记', 'AR', 'SAR', 'FUR'];

type FixtureCard = { cardNumber: string; subset: SubsetKey; code: string; rarity: string };

function thirtiethCards(): FixtureCard[] {
  const cards: FixtureCard[] = [];
  for (const [count, subset, code, rarity] of RUNS) {
    for (let index = 0; index < count; index += 1) {
      cards.push({ cardNumber: String(cards.length + 1).padStart(3, '0'), subset, code, rarity });
    }
  }
  for (const [cardNumber, subset] of LETTERED) {
    cards.push({ cardNumber, subset, code: '无标记', rarity: 'common' });
  }
  return cards;
}

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
  slug: string;
  cardNumber: string | null;
  rarity: string | null;
  rarityCode: string | null;
  attributes: Record<string, unknown> | null;
};

function isListedCard(value: unknown): value is ListedCard {
  return isRecord(value) && typeof value.slug === 'string' && 'rarityCode' in value;
}

function listedCards(body: unknown): ListedCard[] {
  const items = resultData(body).items;
  if (!Array.isArray(items) || !items.every(isListedCard)) throw new Error('expected items');
  return items;
}

describe('cards.listBySeries rarityCode (CH-239 / AC7-7)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`.replace(/[^a-z0-9]/g, '');
  const seriesSlug = `rc30-${suffix}`.slice(0, 64);
  const plainSlug = `rcplain-${suffix}`.slice(0, 64);
  const fixture = thirtiethCards();

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const series = await prisma.series.create({ data: { slug: seriesSlug, title: '30周年' } });
    const subsetIds = new Map<SubsetKey, string>();
    const subsetDefs: Array<[SubsetKey, 'BASE' | 'INSERT']> = [
      ['main', 'BASE'],
      ['secret', 'INSERT'],
      ['special', 'INSERT'],
      ['energy', 'BASE'],
    ];
    for (const [index, [slug, kind]] of subsetDefs.entries()) {
      const subset = await prisma.subset.create({
        data: { seriesId: series.id, slug, name: slug, kind, sortOrder: index },
      });
      subsetIds.set(slug, subset.id);
    }
    // Insert in reverse so storage order is not the printed-number order.
    await prisma.card.createMany({
      data: [...fixture].reverse().map((card) => ({
        slug: `rc-${card.cardNumber.toLowerCase()}-${suffix}`.slice(0, 64),
        name: `卡${card.cardNumber}`,
        rarity: card.rarity,
        cardNumber: card.cardNumber,
        attributes: { 稀有度: card.code, 插画师: 'A' },
        seriesId: series.id,
        subsetId: subsetIds.get(card.subset) ?? null,
      })),
    });

    const plain = await prisma.series.create({ data: { slug: plainSlug, title: '旧品类' } });
    await prisma.card.createMany({
      data: ['1', '2'].map((cardNumber) => ({
        slug: `rcplain-${cardNumber}-${suffix}`.slice(0, 64),
        name: `旧${cardNumber}`,
        rarity: 'rare',
        cardNumber,
        attributes: { cost: 1 },
        seriesId: plain.id,
      })),
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.series.deleteMany({ where: { slug: { in: [seriesSlug, plainSlug] } } });
    }
    await app?.close();
  });

  function list(input: Record<string, unknown>) {
    return request(app.getHttpServer())
      .get('/trpc/cards.listBySeries')
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.141');
  }

  it('filters SAR to the 10 SAR cards and lists the 7 codes in number order', async () => {
    expect(fixture).toHaveLength(176);
    const response = await list({ seriesSlug, rarityCode: 'SAR', pageSize: 100 });
    expect(response.status).toBe(200);
    const body = resultData(response.body);
    const items = listedCards(response.body);

    const sqlCount = await prisma.card.count({
      where: { series: { slug: seriesSlug }, attributes: { path: ['稀有度'], equals: 'SAR' } },
    });
    expect(sqlCount).toBe(10);
    expect(body.total).toBe(sqlCount);
    expect(items).toHaveLength(10);
    expect(items.every((card) => card.rarityCode === 'SAR')).toBe(true);
    expect(items.every((card) => card.attributes?.['稀有度'] === 'SAR')).toBe(true);
    expect(items.map((card) => card.cardNumber)).toEqual(
      Array.from({ length: 10 }, (_, index) => String(124 + index)),
    );
    expect(body.seriesTotal).toBe(176);
    expect(body.rarityCodes).toEqual(THIRTIETH_CODES);
  });

  it('keeps rarityCodes fixed across filters and returns every item rarityCode', async () => {
    for (const input of [
      { seriesSlug },
      { seriesSlug, rarityCode: 'FUR' },
      { seriesSlug, rarity: 'epic' },
      { seriesSlug, subsetSlug: 'energy', sort: 'name' },
      { seriesSlug, q: '卡R', page: 2 },
    ]) {
      const response = await list(input);
      expect(response.status).toBe(200);
      expect(resultData(response.body).rarityCodes).toEqual(THIRTIETH_CODES);
    }
    const all = await list({ seriesSlug, pageSize: 100, page: 2 });
    const tail = listedCards(all.body);
    expect(tail.at(-1)).toMatchObject({ cardNumber: 'WAT', rarityCode: '无标记' });
  });

  it('combines a Chinese code with subset and returns the same count as SQL', async () => {
    const secret = await list({ seriesSlug, rarityCode: '无标记', subsetSlug: 'secret' });
    expect(resultData(secret.body).total).toBe(30);
    const energy = await list({ seriesSlug, rarityCode: '无标记', subsetSlug: 'energy' });
    expect(resultData(energy.body).total).toBe(8);
    const unmarked = await list({ seriesSlug, rarityCode: ' 无标记 ' });
    const sqlCount = await prisma.card.count({
      where: { series: { slug: seriesSlug }, attributes: { path: ['稀有度'], equals: '无标记' } },
    });
    expect(resultData(unmarked.body).total).toBe(sqlCount);
    expect(sqlCount).toBe(71);
  });

  it('returns an empty list, not an error, for a code the series does not have', async () => {
    const response = await list({ seriesSlug, rarityCode: 'XYZ' });
    expect(response.status).toBe(200);
    const body = resultData(response.body);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.seriesTotal).toBe(176);
    expect(body.rarityCodes).toEqual(THIRTIETH_CODES);
    const astral = await list({ seriesSlug, rarityCode: '🂡'.repeat(10) });
    expect(astral.status).toBe(200);
    expect(resultData(astral.body).total).toBe(0);
  });

  it('treats a blank rarityCode as omitted', async () => {
    const plain = resultData((await list({ seriesSlug, pageSize: 100 })).body);
    const blank = resultData((await list({ seriesSlug, pageSize: 100, rarityCode: '   ' })).body);
    expect(blank).toEqual(plain);
    expect(plain.total).toBe(176);
  });

  it('returns an empty rarityCodes and null codes for a series without 稀有度', async () => {
    const response = await list({ seriesSlug: plainSlug });
    expect(response.status).toBe(200);
    const body = resultData(response.body);
    expect(body.rarityCodes).toEqual([]);
    expect(listedCards(response.body).map((card) => card.rarityCode)).toEqual([null, null]);
  });

  it('caches each rarityCode under its own key with the new fields', async () => {
    const redis = app.get(RedisService);
    await list({ seriesSlug, rarityCode: 'SAR' });
    await list({ seriesSlug, rarityCode: '无标记' });
    const sarKey = cardsListBySeriesCacheKey({ seriesSlug, rarityCode: 'SAR' });
    const unmarkedKey = cardsListBySeriesCacheKey({ seriesSlug, rarityCode: '无标记' });
    const fullKey = cardsListBySeriesCacheKey({ seriesSlug });
    expect(new Set([sarKey, unmarkedKey, fullKey]).size).toBe(3);
    const cached = await redis.client.get(sarKey);
    expect(cached).toContain('"rarityCodes":["C","R","RR","无标记","AR","SAR","FUR"]');
    expect(cached).toContain('"rarityCode":"SAR"');
    expect(await redis.client.get(unmarkedKey)).toContain('"rarityCode":"无标记"');
  });

  it('rejects a bad rarityCode with 400 and the validation code, without leaking internals', async () => {
    const cases: Array<{ rarityCode: unknown; message: string }> = [
      { rarityCode: 'X'.repeat(11), message: 'too_big' },
      { rarityCode: '稀'.repeat(11), message: 'too_big' },
      { rarityCode: '🂡'.repeat(11), message: 'too_big' },
      { rarityCode: 5, message: 'invalid_type' },
      { rarityCode: null, message: 'invalid_type' },
      { rarityCode: ['SAR'], message: 'invalid_type' },
    ];
    for (const sample of cases) {
      const response = await list({ seriesSlug, rarityCode: sample.rarityCode });
      expect(response.status).toBe(400);
      expect(response.body.error.data.code).toBe('BAD_REQUEST');
      expect(response.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);
      expect(response.body.error.message).toBe(VALIDATION);
      const issues = response.body.error.data.zodError.issues as Array<{
        path: Array<string | number>;
        message: string;
      }>;
      expect(issues.find((item) => item.path[0] === 'rarityCode')?.message).toBe(sample.message);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('ZodError');
      expect(serialized).not.toContain('Invalid input');
      expect(serialized).not.toContain('Too big');
      expect(serialized).not.toContain('prisma');
      expect(serialized).not.toContain('稀有度');
    }

    const badJson = await request(app.getHttpServer())
      .get('/trpc/cards.listBySeries')
      .query({ input: `{"seriesSlug":"${seriesSlug}","rarityCode":"SAR"` })
      .set('X-Forwarded-For', '203.0.113.142');
    expect(badJson.status).toBe(400);
    const badSerialized = JSON.stringify(badJson.body);
    expect(badSerialized).not.toContain('SyntaxError');
    expect(badSerialized).not.toContain('Unexpected');
    expect(badSerialized).not.toContain('is not valid JSON');
  });
});
