import type { INestApplication } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES, normalizedCardNumber } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * CH-241 search.global against a real database: cardTotal / cardPage paging,
 * relevance order, bare card-number search, and the new card fields. The
 * shape follows the ptcg-sc catalog (30周年 2026-09-16 newer than 151
 * 2025-01-17; 151 has subsets 收录卡 / 编号外). Names carry a run suffix so
 * other suites' rows never match.
 */

type CardRow = {
  id: string;
  slug: string;
  name: string;
  cardNumber: string | null;
  subsetSlug: string | null;
  subsetName: string | null;
};

type GlobalData = { cards: CardRow[]; cardTotal: number; cardPage: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw new Error(`expected string or null, got ${JSON.stringify(value)}`);
}

function globalData(body: unknown): GlobalData {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('missing tRPC result');
  }
  const data = body.result.data;
  if (!Array.isArray(data.cards)) throw new Error('missing cards');
  if (typeof data.cardTotal !== 'number' || typeof data.cardPage !== 'number') {
    throw new Error('missing cardTotal / cardPage');
  }
  const cards = data.cards.map((row): CardRow => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.slug !== 'string') {
      throw new Error('bad card row');
    }
    if (typeof row.name !== 'string') throw new Error('bad card name');
    if (!('cardNumber' in row) || !('subsetSlug' in row) || !('subsetName' in row)) {
      throw new Error(`card ${row.slug} lacks cardNumber / subset fields`);
    }
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      cardNumber: nullableString(row.cardNumber),
      subsetSlug: nullableString(row.subsetSlug),
      subsetName: nullableString(row.subsetName),
    };
  });
  return { cards, cardTotal: data.cardTotal, cardPage: data.cardPage };
}

describe('search.global CH-241 (cardTotal, cardPage, relevance, bare card number)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const term = `闪电鼠${suffix}`;
  const newer = `f30-${suffix}`;
  const older = `f151-${suffix}`;
  const undated = `fnd-${suffix}`;
  // A number no other suite uses, so a global bare-number query is exact.
  const uniqueNumber = String(randomInt(100_000_000, 999_999_999));
  const undatedNumber = String(randomInt(100_000_000, 999_999_999));
  const slugs: string[] = [];

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const series = async (slug: string, releaseDate: string | null) =>
      prisma.series.create({
        data: {
          slug,
          title: `系列${slug}`,
          releaseDate: releaseDate ? new Date(`${releaseDate}T00:00:00.000Z`) : null,
        },
      });
    const s30 = await series(newer, '2026-09-16');
    const s151 = await series(older, '2025-01-17');
    const sNone = await series(undated, null);
    const main = await prisma.subset.create({
      data: { seriesId: s151.id, slug: 'main', name: '收录卡', kind: 'BASE', sortOrder: 0 },
    });
    const secret = await prisma.subset.create({
      data: { seriesId: s151.id, slug: 'secret', name: '编号外', kind: 'INSERT', sortOrder: 1 },
    });

    const card = async (
      seriesId: string,
      slug: string,
      name: string,
      cardNumber: string | null,
      subsetId: string | null = null,
    ) => {
      slugs.push(slug);
      await prisma.card.create({
        data: {
          slug,
          name,
          seriesId,
          subsetId,
          rarity: 'common',
          cardNumber,
          cardNumberNormalized: normalizedCardNumber(cardNumber),
        },
      });
    };

    // 30周年: 6 exact, 2 prefix, 1 contains. Inserted out of order on purpose.
    for (const number of ['046', '017', '136', '020', '018', '019']) {
      await card(s30.id, `${newer}-${number}`, term, number);
    }
    await card(s30.id, `${newer}-047`, `${term}ex`, '047');
    await card(s30.id, `${newer}-160`, `${term}&捷克罗姆GX`, '160');
    await card(s30.id, `${newer}-200`, `雷丘与${term}`, '200');
    await card(s30.id, `${newer}-025`, `原盖海龟${suffix}`, '025');
    // 151: 1 exact in 收录卡, 4 exact in 编号外.
    await card(s151.id, `${older}-025`, term, '025', main.id);
    for (const number of ['173', '170', '172', '171']) {
      await card(s151.id, `${older}-${number}`, term, number, secret.id);
    }
    await card(s151.id, `${older}-025b`, `多多冰${suffix}`, '#025', main.id);
    // Undated series sorts last inside its tier.
    // Random number: a short one like 001 would also match other suites' global `c:1`.
    await card(sNone.id, `${undated}-001`, term, undatedNumber);
    // Bare 25-07 and a unique global number.
    await card(sNone.id, `${undated}-25-07`, `玛俐的莫鲁贝可${suffix}`, '25-07');
    await card(sNone.id, `${undated}-u`, `编号卡${suffix}`, uniqueNumber);
    // Letter card number: bare word does not search it.
    await card(sNone.id, `${undated}-dar`, `基本恶能量${suffix}`, 'DAR');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.series.deleteMany({ where: { slug: { in: [newer, older, undated] } } });
    }
    await app?.close();
  });

  function search(input: unknown) {
    return request(app.getHttpServer())
      .get('/trpc/search.global')
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.141');
  }

  async function okSearch(input: unknown): Promise<GlobalData> {
    const response = await search(input);
    expect(response.status).toBe(200);
    return globalData(response.body);
  }

  async function allPages(q: string, cardLimit: number): Promise<GlobalData[]> {
    const first = await okSearch({ q, cardLimit });
    const pages = [first];
    const pageCount = Math.ceil(first.cardTotal / cardLimit);
    for (let cardPage = 2; cardPage <= pageCount; cardPage += 1) {
      pages.push(await okSearch({ q, cardLimit, cardPage }));
    }
    return pages;
  }

  it('41-1: cardTotal counts every match and pages concatenate without repeats', async () => {
    const pages = await allPages(term, 4);
    expect(pages.map((page) => page.cardPage)).toEqual([1, 2, 3, 4]);
    expect(new Set(pages.map((page) => page.cardTotal))).toEqual(new Set([15]));
    expect(pages.map((page) => page.cards.length)).toEqual([4, 4, 4, 3]);
    const ids = pages.flatMap((page) => page.cards.map((card) => card.id));
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);

    const past = await okSearch({ q: term, cardLimit: 4, cardPage: 99 });
    expect(past).toEqual({ cards: [], cardTotal: 15, cardPage: 99 });
  });

  it('41-2: exact names first, newer series first, then card number; prefix, then contains', async () => {
    const pages = await allPages(term, 5);
    const slugsInOrder = pages.flatMap((page) => page.cards.map((card) => card.slug));
    expect(slugsInOrder).toEqual([
      ...['017', '018', '019', '020', '046', '136'].map((n) => `${newer}-${n}`),
      ...['025', '170', '171', '172', '173'].map((n) => `${older}-${n}`),
      `${undated}-001`,
      `${newer}-047`,
      `${newer}-160`,
      `${newer}-200`,
    ]);
  });

  it('41-3: bare 025 equals c:025 inside a series scope, and the name match still applies', async () => {
    const scope = `s:${older}`;
    const bare = await okSearch({ q: `025 ${scope}`, cardLimit: 50 });
    const prefixed = await okSearch({ q: `c:025 ${scope}`, cardLimit: 50 });
    expect(bare.cards.map((card) => card.slug).sort()).toEqual(
      [`${older}-025`, `${older}-025b`].sort(),
    );
    expect(new Set(bare.cards.map((card) => card.id))).toEqual(
      new Set(prefixed.cards.map((card) => card.id)),
    );
    expect(bare.cardTotal).toBe(2);

    const both = await okSearch({ q: `${term} 025`, cardLimit: 50 });
    expect(both.cards.map((card) => card.slug)).toEqual([`${older}-025`]);
  });

  it('41-3: a bare unique number finds its card globally, same as c:', async () => {
    const bare = await okSearch({ q: uniqueNumber, cardLimit: 50 });
    const prefixed = await okSearch({ q: `c:${uniqueNumber}`, cardLimit: 50 });
    expect(bare.cards.map((card) => card.slug)).toEqual([`${undated}-u`]);
    expect(prefixed.cards.map((card) => card.id)).toEqual(bare.cards.map((card) => card.id));
  });

  it('41-3: bare 25-07 matches the dashed card number; letters stay on c:', async () => {
    const dashed = await okSearch({ q: `25-07 s:${undated}`, cardLimit: 50 });
    expect(dashed.cards.map((card) => card.slug)).toEqual([`${undated}-25-07`]);

    const letters = await okSearch({ q: `DAR s:${undated}`, cardLimit: 50 });
    expect(letters.cards).toEqual([]);
    const prefixed = await okSearch({ q: `c:DAR s:${undated}`, cardLimit: 50 });
    expect(prefixed.cards.map((card) => card.slug)).toEqual([`${undated}-dar`]);
  });

  it('41-4: every card carries cardNumber and its subset; null without a subset', async () => {
    const result = await okSearch({ q: `${term} s:${older}`, cardLimit: 50 });
    expect(result.cards).toHaveLength(5);
    expect(result.cards[0]).toMatchObject({
      slug: `${older}-025`,
      cardNumber: '025',
      subsetSlug: 'main',
      subsetName: '收录卡',
    });
    for (const card of result.cards.slice(1)) {
      expect(card).toMatchObject({ subsetSlug: 'secret', subsetName: '编号外' });
      expect(card.cardNumber).toMatch(/^17[0-3]$/);
    }

    const plain = await okSearch({ q: `${term} s:${newer}`, cardLimit: 1 });
    expect(plain.cards[0]).toMatchObject({ cardNumber: '017', subsetSlug: null, subsetName: null });
  });

  it('41-4: header search without cardPage gets the top 5 by relevance', async () => {
    const header = await okSearch({ q: term, cardLimit: 5, seriesLimit: 3 });
    expect(header.cardPage).toBe(1);
    expect(header.cards.map((card) => card.slug)).toEqual(
      ['017', '018', '019', '020', '046'].map((n) => `${newer}-${n}`),
    );
  });

  it.each([
    ['zero', 0, 'too_small'],
    ['negative', -3, 'too_small'],
    ['fraction', 1.5, 'invalid_type'],
    ['string', '2', 'invalid_type'],
    ['above the cap', 10_001, 'too_big'],
  ])('rejects a %s cardPage with 400 and no internal text', async (_label, cardPage, code) => {
    const response = await search({ q: term, cardPage });
    expect(response.status).toBe(400);
    expect(response.body.error.data.code).toBe('BAD_REQUEST');
    expect(response.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);
    expect(response.body.error.data.zodError.fieldErrors.cardPage).toEqual([code]);
    const serialized = JSON.stringify(response.body);
    for (const leak of ['ZodError', 'Too small', 'Too big', 'Invalid input', 'prisma', 'SELECT']) {
      expect(serialized).not.toContain(leak);
    }
  });
});
