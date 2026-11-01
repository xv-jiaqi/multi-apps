import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES, normalizedCardNumber } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const NORMALIZE_CASES = [
  '7',
  '007',
  '#7',
  '  #007  ',
  'A05',
  'A5',
  '#A05',
  'SV007',
  '7a',
  'A00',
  'PROMO',
  '#',
  '',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('missing tRPC result');
  }
  return body.result.data;
}

function namesOf(body: unknown, key: 'cards' | 'results'): string[] {
  const data = resultData(body);
  const rows = data[key];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => (isRecord(row) && typeof row.name === 'string' ? [row.name] : []));
}

describe('search c: and y: prefixes', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const series2024 = `y24-${suffix}`;
  const series2023 = `y23-${suffix}`;
  const seriesUndated = `ynd-${suffix}`;
  const listSlug = `lstc-${suffix}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const dated = async (slug: string, title: string, releaseDate: string | null) =>
      prisma.series.create({
        data: {
          slug,
          title,
          releaseDate: releaseDate ? new Date(`${releaseDate}T00:00:00.000Z`) : null,
        },
      });

    const year2024 = await dated(series2024, `黎明${suffix}`, '2024-06-15');
    const year2023 = await dated(series2023, `黎明${suffix}旧`, '2023-12-31');
    const undated = await dated(seriesUndated, `黎明${suffix}无`, null);
    const listSeries = await dated(listSlug, `清单${suffix}`, null);

    const card = (seriesId: string, name: string, cardNumber: string | null, rarity: string) =>
      prisma.card.create({
        data: {
          slug: `${name}-${suffix}`.slice(0, 64),
          name,
          rarity,
          seriesId,
          cardNumber,
          cardNumberNormalized: normalizedCardNumber(cardNumber),
        },
      });

    await card(year2024.id, `甲${suffix}`, '007', 'rare');
    await card(year2024.id, `丁${suffix}`, '8', 'common');
    await card(year2023.id, `乙${suffix}`, '#7', 'rare');
    await card(undated.id, `丙${suffix}`, '7', 'rare');
    await card(listSeries.id, `戊${suffix}`, 'A05', 'rare');
    await card(listSeries.id, `己${suffix}`, 'A5', 'common');
    await card(listSeries.id, `庚${suffix}`, 'SV007', 'rare');
    await card(listSeries.id, `辛${suffix}`, '7a', 'rare');
    await card(listSeries.id, `壬${suffix}`, '1', 'common');
    await card(listSeries.id, `癸${suffix}`, '2', 'common');
    await card(listSeries.id, `AAA${suffix}`, '9', 'common');
    await card(listSeries.id, `BBB${suffix}`, '10', 'common');
    await card(listSeries.id, `CCC${suffix}`, '007', 'legendary');
    await card(listSeries.id, `DDD${suffix}`, '#7', 'legendary');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.series.deleteMany({
        where: { slug: { in: [series2024, series2023, seriesUndated, listSlug] } },
      });
    }
    await app?.close();
  });

  function getProcedure(path: string, input: unknown) {
    return request(app.getHttpServer())
      .get(`/trpc/${path}`)
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.80');
  }

  it('keeps the SQL backfill equal to the shared normalizer', async () => {
    for (const value of NORMALIZE_CASES) {
      const rows = await prisma.$queryRaw<Array<{ normalized: string | null }>>`
        SELECT cardhub_card_number_normalized(${value}) AS normalized
      `;
      expect(rows[0]?.normalized).toBe(normalizedCardNumber(value));
    }
  });

  it('matches c: exactly and applies the limit after the filter', async () => {
    const seven = await getProcedure('search.global', { q: 'c:7', limit: 10 });
    expect(seven.status).toBe(200);
    const sevenNames = namesOf(seven.body, 'cards').sort();
    expect(sevenNames).toEqual(
      [`CCC${suffix}`, `DDD${suffix}`, `丙${suffix}`, `乙${suffix}`, `甲${suffix}`].sort(),
    );
    expect(sevenNames).not.toContain(`庚${suffix}`);
    expect(sevenNames).not.toContain(`辛${suffix}`);

    const limited = await getProcedure('cards.search', { q: 'c:7', limit: 2 });
    expect(limited.status).toBe(200);
    expect(namesOf(limited.body, 'results')).toEqual([`CCC${suffix}`, `DDD${suffix}`]);

    const prefix = await getProcedure('search.global', { q: 'c:A05', limit: 10 });
    expect(namesOf(prefix.body, 'cards').sort()).toEqual([`己${suffix}`, `戊${suffix}`].sort());

    const firstOnly = await getProcedure('search.global', { q: 'c:1 c:2', limit: 10 });
    expect(namesOf(firstOnly.body, 'cards')).toEqual([`壬${suffix}`]);

    const upper = await getProcedure('search.global', { q: 'C:1', limit: 10 });
    expect(namesOf(upper.body, 'cards')).toEqual([`壬${suffix}`]);
  });

  it('filters y: to the Shanghai release year and ignores a bad year token', async () => {
    const yearAndRarity = await getProcedure('search.global', { q: 'y:2024 r:rare', limit: 10 });
    expect(yearAndRarity.status).toBe(200);
    expect(namesOf(yearAndRarity.body, 'cards')).toEqual([`甲${suffix}`]);

    const titled = await getProcedure('search.global', {
      q: `y:2024 黎明${suffix}`,
      limit: 10,
    });
    expect(titled.status).toBe(200);
    const series = resultData(titled.body).series;
    const titles = Array.isArray(series)
      ? series.flatMap((row) => (isRecord(row) && typeof row.title === 'string' ? [row.title] : []))
      : [];
    expect(titles).toContain(`黎明${suffix}`);
    expect(titles).not.toContain(`黎明${suffix}旧`);
    expect(titles).not.toContain(`黎明${suffix}无`);

    const ignored = await getProcedure('search.global', { q: 'y:02024 r:rare', limit: 20 });
    expect(ignored.status).toBe(200);
    const ignoredNames = namesOf(ignored.body, 'cards');
    expect(ignoredNames).toEqual(
      expect.arrayContaining([`甲${suffix}`, `乙${suffix}`, `丙${suffix}`]),
    );
    expect(ignoredNames).not.toContain(`丁${suffix}`);

    for (const q of ['y:0000', 'y:0999', 'y:9999', 'y:abc']) {
      const response = await getProcedure('search.global', { q, limit: 5 });
      expect(response.status).toBe(200);
      expect(namesOf(response.body, 'cards')).toEqual([]);
    }

    const tooLongQuery = `c:${'N'.repeat(21)}`;
    const tooLong = await getProcedure('cards.search', { q: tooLongQuery, limit: 5 });
    expect(tooLong.status).toBe(200);
    expect(namesOf(tooLong.body, 'results')).toEqual([]);

    const oversized = await getProcedure('search.global', { q: 'x'.repeat(201), limit: 5 });
    expect(oversized.status).toBe(400);
    expect(oversized.body.error.data.code).toBe('BAD_REQUEST');
    expect(oversized.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);
    expect(JSON.stringify(oversized.body)).not.toContain('Too big');
  });

  it('keeps c: and y: off listBySeries and returns an empty page past the end', async () => {
    const literal = await getProcedure('cards.listBySeries', { seriesSlug: listSlug, q: 'c:7' });
    expect(literal.status).toBe(200);
    expect(resultData(literal.body).total).toBe(0);
    expect(resultData(literal.body).seriesTotal).toBe(10);

    const plain = await getProcedure('cards.listBySeries', { seriesSlug: listSlug, q: '#7' });
    expect(resultData(plain.body).total).toBe(1);
    expect(resultData(plain.body).seriesTotal).toBe(10);

    const past = await getProcedure('cards.listBySeries', {
      seriesSlug: listSlug,
      page: 50,
      pageSize: 1,
    });
    expect(past.status).toBe(200);
    const pastBody = resultData(past.body);
    expect(pastBody.items).toEqual([]);
    expect(pastBody.total).toBe(10);
    expect(pastBody.seriesTotal).toBe(10);

    const oversizePage = await getProcedure('cards.listBySeries', {
      seriesSlug: listSlug,
      page: 10_001,
    });
    expect(oversizePage.status).toBe(400);
    expect(oversizePage.body.error.data.code).toBe('BAD_REQUEST');
  });
});
