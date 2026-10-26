import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Postgres accepts timestamps that Prisma's Date decoder cannot turn into a
 * valid Date. `series.bySlug` used to call `toISOString()` on that value and
 * answer 500 with the English exception text.
 */
describe('series.bySlug extreme timestamps', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `ts-${Date.now().toString(36)}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.series.create({ data: { slug, title: '时间边界系列' } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRaw`DELETE FROM series WHERE slug = ${slug}`;
    }
    await app?.close();
  });

  async function setCreatedAt(value: string) {
    await prisma.$executeRawUnsafe(
      `UPDATE series SET "createdAt" = $1::timestamp WHERE slug = $2`,
      value,
      slug,
    );
  }

  function getSeries() {
    return request(app.getHttpServer())
      .get('/trpc/series.bySlug')
      .query({ input: JSON.stringify({ slug }) });
  }

  it('returns the series when createdAt is a year Prisma decodes as an invalid Date', async () => {
    await setCreatedAt('10000-01-01T00:00:00.000Z');
    const response = await getSeries();
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(response.body.result.data.title).toBe('时间边界系列');
    expect(response.body.result.data.slug).toBe(slug);
    const createdAt = response.body.result.data.createdAt as string;
    expect(createdAt).toBe('+010000-01-01T00:00:00.000Z');
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
    expect(serialized).not.toContain('Invalid time value');
    expect(serialized).not.toContain('prisma.series.findUnique');
  });

  it('returns a round-trippable ISO string for a BCE timestamp', async () => {
    await setCreatedAt('0001-01-01 BC');
    const response = await getSeries();
    const createdAt = response.body.result.data.createdAt as string;

    expect(response.status).toBe(200);
    expect(createdAt).toBe('-000001-01-01T00:00:00.000Z');
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
  });

  it('rejects infinity without widening createdAt to null or leaking the decoder', async () => {
    await setCreatedAt('infinity');
    const response = await getSeries();
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(500);
    expect(response.body.result?.data?.createdAt).toBeUndefined();
    expect(serialized).not.toContain('value too large to decode');
    expect(serialized).not.toContain('Invalid time value');
  });
});
