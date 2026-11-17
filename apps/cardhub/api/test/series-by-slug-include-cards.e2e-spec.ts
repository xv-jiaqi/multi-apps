import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

type SeriesBySlugBody = {
  result?: {
    data?: {
      slug?: unknown;
      title?: unknown;
      cards?: unknown;
      baseCardCount?: unknown;
      releases?: unknown;
    };
  };
};

describe('series.bySlug includeCards and baseCardCount (CH-240)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `ch240-${Date.now().toString(36)}`;
  const slugs = {
    series: slug,
    baseA: `${slug}-base-a`,
    baseB: `${slug}-base-b`,
    parallel: `${slug}-parallel`,
  };

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const series = await prisma.series.create({
      data: { slug: slugs.series, title: '首屏提速系列' },
    });
    const baseA = await prisma.card.create({
      data: { slug: slugs.baseA, name: '基础甲', seriesId: series.id },
    });
    await prisma.card.create({
      data: { slug: slugs.baseB, name: '基础乙', seriesId: series.id },
    });
    await prisma.card.create({
      data: {
        slug: slugs.parallel,
        name: '平行甲',
        seriesId: series.id,
        parallelOfId: baseA.id,
        parallelName: '全息',
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.series.deleteMany({ where: { slug: slugs.series } });
    }
    await app?.close();
  });

  function getSeries(input: { slug: string; includeCards?: boolean }) {
    return request(app.getHttpServer())
      .get('/trpc/series.bySlug')
      .query({ input: JSON.stringify(input) });
  }

  function dataOf(body: SeriesBySlugBody) {
    const data = body.result?.data;
    if (data === undefined) throw new Error('expected series.bySlug data');
    return data;
  }

  it('still returns cards when includeCards is omitted, and adds baseCardCount', async () => {
    const response = await getSeries({ slug: slugs.series });
    expect(response.status).toBe(200);
    const data = dataOf(response.body);
    expect(data.slug).toBe(slugs.series);
    expect(data.title).toBe('首屏提速系列');
    expect(Array.isArray(data.cards)).toBe(true);
    const cards = data.cards as Array<{ slug: string; parallelOfId: string | null }>;
    expect(cards.map((card) => card.slug).sort()).toEqual(
      [slugs.baseA, slugs.baseB, slugs.parallel].sort(),
    );
    expect(data.baseCardCount).toBe(2);
    expect(cards.filter((card) => card.parallelOfId == null)).toHaveLength(2);
    expect(Array.isArray(data.releases)).toBe(true);
  });

  it('returns the same cards payload when includeCards is true', async () => {
    const omitted = await getSeries({ slug: slugs.series });
    const included = await getSeries({ slug: slugs.series, includeCards: true });
    expect(included.status).toBe(200);
    const left = dataOf(omitted.body);
    const right = dataOf(included.body);
    expect(right.cards).toEqual(left.cards);
    expect(right.baseCardCount).toBe(left.baseCardCount);
    expect(right.slug).toBe(left.slug);
  });

  it('omits cards when includeCards is false and still returns baseCardCount', async () => {
    const response = await getSeries({ slug: slugs.series, includeCards: false });
    expect(response.status).toBe(200);
    const data = dataOf(response.body);
    expect(data.slug).toBe(slugs.series);
    expect(data.title).toBe('首屏提速系列');
    expect(data.baseCardCount).toBe(2);
    expect(data.cards).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(data, 'cards')).toBe(false);
    expect(Array.isArray(data.releases)).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain(slugs.baseA);
    expect(JSON.stringify(response.body)).not.toContain(slugs.parallel);
  });
});
