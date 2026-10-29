import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Postgres accepts timestamps that Prisma's Date decoder cannot turn into a
 * valid Date. `series.bySlug` used to call `toISOString()` on that value and
 * answer 500 with the English exception text.
 *
 * Each case uses its own slug. The public read is cached, and these cases
 * change the timestamp with SQL instead of an admin write, so they must not
 * share a cache key.
 */
describe('series.bySlug extreme timestamps', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugs: string[] = [];

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma && slugs.length > 0) {
      await prisma.series.deleteMany({ where: { slug: { in: slugs } } });
    }
    await app?.close();
  });

  async function insertSeries(): Promise<string> {
    const slug = `ts-${Date.now().toString(36)}-${slugs.length}`;
    slugs.push(slug);
    await prisma.series.create({ data: { slug, title: '时间边界系列' } });
    return slug;
  }

  async function setCreatedAt(slug: string, value: string) {
    await prisma.$executeRawUnsafe(
      `UPDATE series SET "createdAt" = $1::timestamp WHERE slug = $2`,
      value,
      slug,
    );
  }

  function getSeries(slug: string) {
    return request(app.getHttpServer())
      .get('/trpc/series.bySlug')
      .query({ input: JSON.stringify({ slug }) });
  }

  function createdAtOf(body: { result?: { data?: { createdAt?: unknown } } }): string {
    const createdAt = body.result?.data?.createdAt;
    if (typeof createdAt !== 'string') throw new Error('expected createdAt');
    return createdAt;
  }

  it('returns the series when createdAt is a year Prisma decodes as an invalid Date', async () => {
    const slug = await insertSeries();
    await setCreatedAt(slug, '10000-01-01T00:00:00.000Z');
    const response = await getSeries(slug);
    const serialized = JSON.stringify(response.body);
    const createdAt = createdAtOf(response.body);

    expect(response.status).toBe(200);
    expect(response.body.result.data.title).toBe('时间边界系列');
    expect(response.body.result.data.slug).toBe(slug);
    expect(createdAt).toBe('+010000-01-01T00:00:00.000Z');
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
    expect(serialized).not.toContain('Invalid time value');
    expect(serialized).not.toContain('prisma.series.findUnique');
  });

  it('returns astronomical year 0000 for 1 BC', async () => {
    const slug = await insertSeries();
    await setCreatedAt(slug, '0001-01-01 BC');
    const response = await getSeries(slug);
    const createdAt = createdAtOf(response.body);

    expect(response.status).toBe(200);
    expect(createdAt).toBe('0000-01-01T00:00:00.000Z');
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
    expect(new Date(createdAt).getUTCFullYear()).toBe(0);
  });

  it('returns astronomical year -000001 for 2 BC', async () => {
    const slug = await insertSeries();
    await setCreatedAt(slug, '0002-01-01 BC');
    const response = await getSeries(slug);
    const createdAt = createdAtOf(response.body);

    expect(response.status).toBe(200);
    expect(createdAt).toBe('-000001-01-01T00:00:00.000Z');
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
    expect(new Date(createdAt).getUTCFullYear()).toBe(-1);
  });

  it('rejects infinity without widening createdAt to null or leaking the decoder', async () => {
    const slug = await insertSeries();
    await setCreatedAt(slug, 'infinity');
    const response = await getSeries(slug);
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(500);
    expect(response.body.result?.data?.createdAt).toBeUndefined();
    expect(serialized).not.toContain('value too large to decode');
    expect(serialized).not.toContain('Invalid time value');
  });
});
