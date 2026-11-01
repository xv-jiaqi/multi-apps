import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('expected tRPC result data');
  }
  return body.result.data;
}

function rowsOf(body: unknown, key: string): Record<string, unknown>[] {
  const value = resultData(body)[key];
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(`expected ${key}`);
  return value;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`expected ${key}`);
  return value;
}

describe('search series cardCount', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const seriesSlug = `base-count-${suffix}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const series = await prisma.series.create({
      data: { slug: seriesSlug, title: `母卡计数${suffix}` },
    });
    const base = await prisma.card.create({
      data: { slug: `base-${suffix}`, name: `基础${suffix}`, seriesId: series.id },
    });
    await prisma.card.create({
      data: { slug: `base-2-${suffix}`, name: `另一张${suffix}`, seriesId: series.id },
    });
    await prisma.card.create({
      data: {
        slug: `par-a-${suffix}`,
        name: `平行甲${suffix}`,
        seriesId: series.id,
        parallelOfId: base.id,
        parallelName: '金箔',
      },
    });
    await prisma.card.create({
      data: {
        slug: `par-b-${suffix}`,
        name: `平行乙${suffix}`,
        seriesId: series.id,
        parallelOfId: base.id,
        parallelName: '银折',
      },
    });
  });

  afterAll(async () => {
    if (prisma) await prisma.series.deleteMany({ where: { slug: seriesSlug } });
    await app?.close();
  });

  it('counts only base cards in search.global series cardCount', async () => {
    const response = await request(app.getHttpServer())
      .get('/trpc/search.global')
      .query({ input: JSON.stringify({ q: `母卡计数${suffix}`, limit: 5 }) });
    expect(response.status).toBe(200);
    const series = rowsOf(response.body, 'series').find((row) => row.slug === seriesSlug);
    if (!series) throw new Error('expected series hit');
    expect(text(series, 'slug')).toBe(seriesSlug);
    expect(series.cardCount).toBe(2);
  });
});

describe('search literals', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const percentSlug = `pct-${suffix}`;
  const wildSlug = `wild-${suffix}`;
  const underSlug = `under-${suffix}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const percent = await prisma.series.create({
      data: { slug: percentSlug, title: `100%${suffix}` },
    });
    await prisma.series.create({
      data: { slug: wildSlug, title: `100x${suffix}` },
    });
    const under = await prisma.series.create({
      data: { slug: underSlug, title: `a_b${suffix}` },
    });
    await prisma.series.create({
      data: { slug: `any-${suffix}`, title: `axb${suffix}` },
    });
    const base = await prisma.card.create({
      data: { slug: `pct-card-${suffix}`, name: `100%${suffix}`, seriesId: percent.id },
    });
    await prisma.card.create({
      data: { slug: `wild-card-${suffix}`, name: `100x${suffix}`, seriesId: percent.id },
    });
    await prisma.card.create({
      data: {
        slug: `pct-par-${suffix}`,
        name: `素卡${suffix}`,
        seriesId: percent.id,
        parallelOfId: base.id,
        parallelName: `100%${suffix}`,
      },
    });
    await prisma.card.create({
      data: { slug: `under-card-${suffix}`, name: `a_b${suffix}`, seriesId: under.id },
    });
    await prisma.card.create({
      data: { slug: `any-card-${suffix}`, name: `axb${suffix}`, seriesId: under.id },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.series.deleteMany({
        where: { slug: { in: [percentSlug, wildSlug, underSlug, `any-${suffix}`] } },
      });
    }
    await app?.close();
  });

  function names(body: unknown, key: 'cards' | 'results'): string[] {
    return rowsOf(body, key).map((row) => text(row, 'name'));
  }

  function seriesSlugs(body: unknown): string[] {
    return rowsOf(body, 'series').map((row) => text(row, 'slug'));
  }

  it('matches 100% and a_b as typed text on both card and series search', async () => {
    const percent = await request(app.getHttpServer())
      .get('/trpc/search.global')
      .query({ input: JSON.stringify({ q: `100%${suffix}`, limit: 10 }) });
    expect(percent.status).toBe(200);
    expect(names(percent.body, 'cards').sort()).toEqual([`100%${suffix}`, `素卡${suffix}`].sort());
    expect(seriesSlugs(percent.body)).toEqual([percentSlug]);

    const percentSearch = await request(app.getHttpServer())
      .get('/trpc/cards.search')
      .query({ input: JSON.stringify({ q: `100%${suffix}`, seriesSlug: percentSlug, limit: 10 }) });
    expect(percentSearch.status).toBe(200);
    expect(names(percentSearch.body, 'results').sort()).toEqual(
      [`100%${suffix}`, `素卡${suffix}`].sort(),
    );

    const under = await request(app.getHttpServer())
      .get('/trpc/search.global')
      .query({ input: JSON.stringify({ q: `a_b${suffix}`, limit: 10 }) });
    expect(under.status).toBe(200);
    expect(names(under.body, 'cards')).toEqual([`a_b${suffix}`]);
    expect(seriesSlugs(under.body)).toEqual([underSlug]);

    const underSearch = await request(app.getHttpServer())
      .get('/trpc/cards.search')
      .query({ input: JSON.stringify({ q: `a_b${suffix}`, seriesSlug: underSlug, limit: 10 }) });
    expect(underSearch.status).toBe(200);
    expect(names(underSearch.body, 'results')).toEqual([`a_b${suffix}`]);
  });
});
