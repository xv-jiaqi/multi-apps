import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * CH-237 / cut-7 AC7-4. Card numbers without digits sort after the numbered
 * cards, grouped by their subset sortOrder, then by text. The fixture has the
 * ptcg-sc-30th shape: special (sortOrder 2) R G B and energy (sortOrder 3),
 * whose plain text order would interleave the two subsets.
 */

type Subset = 'main' | 'secret' | 'special' | 'energy' | null;

const FIXTURE: { cardNumber: string; subset: Subset }[] = [
  { cardNumber: 'WAT', subset: 'energy' },
  { cardNumber: 'R', subset: 'special' },
  { cardNumber: 'GRA', subset: 'energy' },
  { cardNumber: 'B', subset: 'special' },
  { cardNumber: '010', subset: 'main' },
  { cardNumber: 'DAR', subset: 'energy' },
  { cardNumber: 'LOOSE', subset: null },
  { cardNumber: 'G', subset: 'special' },
  { cardNumber: '104', subset: 'secret' },
  { cardNumber: 'FIG', subset: 'energy' },
  { cardNumber: '002', subset: 'main' },
];

const NUMBER_ORDER = ['002', '010', '104', 'B', 'G', 'R', 'DAR', 'FIG', 'GRA', 'WAT', 'LOOSE'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('expected tRPC result data');
  }
  return body.result.data;
}

function cardNumbers(body: unknown): string[] {
  const items = resultData(body).items;
  if (!Array.isArray(items)) throw new Error('expected items');
  return items.map((item) => {
    if (!isRecord(item) || typeof item.cardNumber !== 'string') {
      throw new Error('expected a card number');
    }
    return item.cardNumber;
  });
}

function neighbourSlug(body: unknown, side: 'prev' | 'next'): string | null {
  const adjacent = resultData(body).adjacent;
  if (!isRecord(adjacent)) throw new Error('expected adjacent');
  const card = adjacent[side];
  if (card === null) return null;
  if (!isRecord(card) || typeof card.slug !== 'string') throw new Error('expected a neighbour');
  return card.slug;
}

describe('cards.listBySeries letter card numbers (CH-237)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`.replace(/[^a-z0-9]/g, '');
  const seriesSlug = `ltr-${suffix}`.slice(0, 64);
  const slugOf = (cardNumber: string) => `ltr-${cardNumber.toLowerCase()}-${suffix}`.slice(0, 64);

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const series = await prisma.series.create({ data: { slug: seriesSlug, title: '字母卡号' } });
    // Created out of sortOrder so neither creation order nor slug decides.
    const created = {
      energy: await prisma.subset.create({
        data: { seriesId: series.id, slug: 'energy', name: '基本能量', kind: 'BASE', sortOrder: 3 },
      }),
      main: await prisma.subset.create({
        data: { seriesId: series.id, slug: 'main', name: '收录卡', kind: 'BASE', sortOrder: 0 },
      }),
      special: await prisma.subset.create({
        data: {
          seriesId: series.id,
          slug: 'special',
          name: '特别式样',
          kind: 'INSERT',
          sortOrder: 2,
        },
      }),
      secret: await prisma.subset.create({
        data: { seriesId: series.id, slug: 'secret', name: '编号外', kind: 'INSERT', sortOrder: 1 },
      }),
    };
    await prisma.card.createMany({
      data: FIXTURE.map((card) => ({
        slug: slugOf(card.cardNumber),
        name: card.cardNumber,
        cardNumber: card.cardNumber,
        seriesId: series.id,
        subsetId: card.subset ? created[card.subset].id : null,
      })),
    });
  });

  afterAll(async () => {
    if (prisma) await prisma.series.deleteMany({ where: { slug: seriesSlug } });
    await app?.close();
  });

  function getProcedure(path: string, input: unknown) {
    return request(app.getHttpServer())
      .get(`/trpc/${path}`)
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.137');
  }

  it('puts numbered cards first, then letters by subset sortOrder, then letters without a subset', async () => {
    const listed = await getProcedure('cards.listBySeries', {
      seriesSlug,
      sort: 'number',
      pageSize: 100,
    });
    expect(listed.status).toBe(200);
    expect(cardNumbers(listed.body)).toEqual(NUMBER_ORDER);
    expect(resultData(listed.body).total).toBe(FIXTURE.length);
  });

  it('sorts the whole series before slicing each page', async () => {
    const pages: string[] = [];
    for (const page of [1, 2, 3, 4]) {
      const listed = await getProcedure('cards.listBySeries', {
        seriesSlug,
        sort: 'number',
        page,
        pageSize: 3,
      });
      expect(listed.status).toBe(200);
      expect(resultData(listed.body).total).toBe(FIXTURE.length);
      pages.push(...cardNumbers(listed.body));
    }
    expect(pages).toEqual(NUMBER_ORDER);
  });

  it('keeps card page neighbours inside the subset', async () => {
    const g = await getProcedure('cards.bySlug', { slug: slugOf('G') });
    expect(g.status).toBe(200);
    expect(neighbourSlug(g.body, 'prev')).toBe(slugOf('B'));
    expect(neighbourSlug(g.body, 'next')).toBe(slugOf('R'));

    const dar = await getProcedure('cards.bySlug', { slug: slugOf('DAR') });
    expect(neighbourSlug(dar.body, 'prev')).toBeNull();
    expect(neighbourSlug(dar.body, 'next')).toBe(slugOf('FIG'));

    const r = await getProcedure('cards.bySlug', { slug: slugOf('R') });
    expect(neighbourSlug(r.body, 'next')).toBeNull();
  });
});
