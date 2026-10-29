import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { APP_ERROR_CODES } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

let sequence = 0;

function nextIdentity(label: string) {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
  return {
    email: `${label}-${suffix}@cardhub.test`,
    username: `${label}${suffix}`.replace(/[^a-z0-9]/gi, '').slice(0, 24),
    ip: `198.51.100.${(sequence % 200) + 1}`,
  };
}

function resultData(body: { result?: { data?: unknown } }): Record<string, unknown> {
  const data = body.result?.data;
  if (typeof data !== 'object' || data === null) throw new Error('expected a result object');
  return data;
}

describe('catalog taxonomy', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken = '';
  let userToken = '';
  const suffix = `${Date.now().toString(36)}`;
  const categorySlug = `tax-cat-${suffix}`.slice(0, 64);
  const seriesSlug = `tax-series-${suffix}`.slice(0, 64);
  const otherSeriesSlug = `tax-other-${suffix}`.slice(0, 64);
  const subsetSlug = 'base';
  const cardSlug = `tax-card-${suffix}`.slice(0, 64);
  const plainCardSlug = `tax-plain-${suffix}`.slice(0, 64);

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const admin = nextIdentity('taxadm');
    const member = nextIdentity('taxusr');
    adminToken = (await register(admin)).token;
    userToken = (await register(member)).token;
    const adminRow = await prisma.user.findUnique({ where: { email: admin.email } });
    if (!adminRow) throw new Error('admin missing');
    await prisma.user.update({ where: { id: adminRow.id }, data: { role: 'admin' } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.card.deleteMany({ where: { slug: { in: [cardSlug, plainCardSlug] } } });
      await prisma.series.deleteMany({ where: { slug: { in: [seriesSlug, otherSeriesSlug] } } });
      await prisma.category.deleteMany({ where: { slug: categorySlug } });
    }
    await app?.close();
  });

  function post(path: string, body: unknown, token?: string, ip = '203.0.113.80') {
    const req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  function get(path: string, input: unknown, token?: string) {
    const req = request(app.getHttpServer())
      .get(`/trpc/${path}`)
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.81');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  }

  async function register(identity: ReturnType<typeof nextIdentity>) {
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({
        email: identity.email,
        username: identity.username,
        password: 'taxonomy-password',
      });
    expect(response.status).toBe(200);
    return { token: String(resultData(response.body).token) };
  }

  it('rejects non-admin category and subset writes with FORBIDDEN', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const writes: Array<[string, unknown]> = [
      ['admin.categories.create', { slug: categorySlug, name: '品类' }],
      ['admin.categories.update', { slug: categorySlug, name: '品类' }],
      ['admin.categories.delete', { slug: categorySlug }],
      ['admin.subsets.create', { seriesSlug, slug: subsetSlug, name: '主卡', kind: 'BASE' }],
      ['admin.subsets.update', { seriesSlug, slug: subsetSlug, name: '主卡', kind: 'BASE' }],
      ['admin.subsets.delete', { seriesSlug, slug: subsetSlug }],
    ];
    try {
      for (const [path, body] of writes) {
        const member = await post(path, body, userToken, '203.0.113.82');
        expect(member.status).toBe(403);
        expect(member.body.error.data.code).toBe('FORBIDDEN');
        expect(member.body.error.data.appCode).toBe(APP_ERROR_CODES.FORBIDDEN);
        expect(member.body.error.message).toBe('仅管理员可管理内容');
        expect(JSON.stringify(member.body)).not.toContain('prisma');

        const anonymous = await post(path, body, undefined, '203.0.113.83');
        expect(anonymous.status).toBe(401);
        expect(anonymous.body.error.data.appCode).toBe(APP_ERROR_CODES.UNAUTHORIZED);
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('serves category, subset, and card number, then nulls and cascades', async () => {
    const createdCategory = await post(
      'admin.categories.create',
      { slug: categorySlug, name: '构筑对战', description: '一套', sortOrder: 2 },
      adminToken,
    );
    expect(createdCategory.status).toBe(200);
    expect(resultData(createdCategory.body).slug).toBe(categorySlug);

    const createdSeries = await post(
      'admin.series.create',
      {
        slug: seriesSlug,
        title: '分类系列',
        categorySlug,
        releaseDate: '2024-03-15',
      },
      adminToken,
    );
    expect(createdSeries.status).toBe(200);

    const createdSubset = await post(
      'admin.subsets.create',
      { seriesSlug, slug: subsetSlug, name: '主卡', kind: 'BASE', sortOrder: 0 },
      adminToken,
    );
    expect(createdSubset.status).toBe(200);

    const createdCard = await post(
      'admin.cards.create',
      {
        slug: cardSlug,
        name: '编号卡',
        rarity: 'common',
        attributes: {},
        seriesSlug,
        subsetSlug,
        cardNumber: '001',
      },
      adminToken,
    );
    expect(createdCard.status).toBe(200);
    expect(resultData(createdCard.body)).toMatchObject({
      cardNumber: '001',
      subsetSlug,
    });

    const plainSeries = await prisma.series.create({
      data: { slug: otherSeriesSlug, title: '旧系列' },
    });
    await prisma.card.create({
      data: { slug: plainCardSlug, name: '旧卡', seriesId: plainSeries.id },
    });

    const categoryList = await get('categories.list', {});
    expect(categoryList.status).toBe(200);
    const listed = resultData(categoryList.body).items as Array<{
      slug: string;
      seriesCount: number;
    }>;
    expect(listed.find((item) => item.slug === categorySlug)?.seriesCount).toBe(1);

    const categoryDetail = await get('categories.bySlug', { slug: categorySlug });
    expect(categoryDetail.status).toBe(200);
    const detailSeries = resultData(categoryDetail.body).series as Array<{
      slug: string;
      releaseDate: string | null;
    }>;
    expect(detailSeries.map((item) => item.slug)).toContain(seriesSlug);
    expect(detailSeries.find((item) => item.slug === seriesSlug)?.releaseDate).toBe('2024-03-15');

    const seriesDetail = await get('series.bySlug', { slug: seriesSlug });
    expect(seriesDetail.status).toBe(200);
    const seriesBody = resultData(seriesDetail.body);
    expect(seriesBody.subsets).toEqual([
      { slug: subsetSlug, name: '主卡', kind: 'BASE', sortOrder: 0 },
    ]);
    const cards = seriesBody.cards as Array<{
      slug: string;
      cardNumber: string | null;
      subsetSlug: string | null;
    }>;
    expect(cards.find((card) => card.slug === cardSlug)).toMatchObject({
      cardNumber: '001',
      subsetSlug,
    });

    const plainSeriesDetail = await get('series.bySlug', { slug: otherSeriesSlug });
    expect(plainSeriesDetail.status).toBe(200);
    const plainCards = resultData(plainSeriesDetail.body).cards as Array<{
      slug: string;
      cardNumber: string | null;
      subsetSlug: string | null;
    }>;
    expect(plainCards).toEqual([
      expect.objectContaining({ slug: plainCardSlug, cardNumber: null, subsetSlug: null }),
    ]);
    expect(resultData(plainSeriesDetail.body).subsets).toEqual([]);

    const plainCard = await get('cards.bySlug', { slug: plainCardSlug });
    expect(plainCard.status).toBe(200);
    expect(resultData(plainCard.body)).toMatchObject({
      slug: plainCardSlug,
      cardNumber: null,
      subset: null,
    });

    const filtered = await get('series.list', {
      categorySlug,
      year: 2024,
      sort: 'releaseDateDesc',
      page: 1,
      pageSize: 20,
    });
    expect(filtered.status).toBe(200);
    const filteredBody = resultData(filtered.body);
    const filteredItems = filteredBody.items as Array<{ slug: string }>;
    expect(filteredItems.map((item) => item.slug)).toEqual([seriesSlug]);
    expect(filteredBody.years).toEqual(expect.arrayContaining([2024]));

    const unknownCategory = await get('series.list', { categorySlug: 'missing-category-slug' });
    expect(unknownCategory.status).toBe(200);
    expect(resultData(unknownCategory.body).items).toEqual([]);
    expect(resultData(unknownCategory.body).total).toBe(0);

    const removedSubset = await post(
      'admin.subsets.delete',
      { seriesSlug, slug: subsetSlug },
      adminToken,
    );
    expect(removedSubset.status).toBe(200);
    expect(resultData(removedSubset.body)).toMatchObject({ ok: true, cardCount: 1 });
    const ungrouped = await prisma.card.findUnique({ where: { slug: cardSlug } });
    expect(ungrouped?.subsetId).toBeNull();
    expect(ungrouped?.name).toBe('编号卡');
    const afterSubset = await get('series.bySlug', { slug: seriesSlug });
    const afterCards = resultData(afterSubset.body).cards as Array<{
      slug: string;
      subsetSlug: string | null;
    }>;
    expect(afterCards.find((card) => card.slug === cardSlug)?.subsetSlug).toBeNull();
    expect(
      await prisma.subset.count({ where: { slug: subsetSlug, series: { slug: seriesSlug } } }),
    ).toBe(0);

    const replacement = await post(
      'admin.subsets.create',
      { seriesSlug, slug: 'extra', name: '追加', kind: 'INSERT' },
      adminToken,
    );
    expect(replacement.status).toBe(200);

    const removedSeries = await post(
      'admin.series.delete',
      { slug: seriesSlug, force: true },
      adminToken,
    );
    expect(removedSeries.status).toBe(200);
    expect(await prisma.subset.count({ where: { series: { slug: seriesSlug } } })).toBe(0);
    expect(await prisma.series.findUnique({ where: { slug: seriesSlug } })).toBeNull();

    const orphanSeries = await prisma.series.create({
      data: { slug: seriesSlug, title: '再挂分类', category: { connect: { slug: categorySlug } } },
    });
    const removedCategory = await post(
      'admin.categories.delete',
      { slug: categorySlug },
      adminToken,
    );
    expect(removedCategory.status).toBe(200);
    const detached = await prisma.series.findUnique({ where: { id: orphanSeries.id } });
    expect(detached).not.toBeNull();
    expect(detached?.categoryId).toBeNull();
    expect(await prisma.category.findUnique({ where: { slug: categorySlug } })).toBeNull();
  });

  it('clears subsetId when an import moves a card onto another series', async () => {
    const sourceSlug = `imp-src-${suffix}`.slice(0, 64);
    const destSlug = `imp-dst-${suffix}`.slice(0, 64);
    const movedSlug = `imp-card-${suffix}`.slice(0, 64);
    try {
      expect(
        (await post('admin.series.create', { slug: sourceSlug, title: '导入来源' }, adminToken))
          .status,
      ).toBe(200);
      expect(
        (
          await post(
            'admin.subsets.create',
            { seriesSlug: sourceSlug, slug: 'a-base', name: '来源子集', kind: 'BASE' },
            adminToken,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await post(
            'admin.cards.create',
            {
              slug: movedSlug,
              name: '挪走的卡',
              rarity: 'common',
              attributes: {},
              seriesSlug: sourceSlug,
              subsetSlug: 'a-base',
              cardNumber: '001',
            },
            adminToken,
          )
        ).status,
      ).toBe(200);
      expect(
        (await post('admin.series.create', { slug: destSlug, title: '导入目标' }, adminToken))
          .status,
      ).toBe(200);
      expect(
        (
          await post(
            'admin.subsets.create',
            { seriesSlug: destSlug, slug: 'b-base', name: '目标子集', kind: 'BASE' },
            adminToken,
          )
        ).status,
      ).toBe(200);

      const imported = await post(
        'admin.catalog.import',
        {
          dryRun: false,
          data: [
            {
              slug: destSlug,
              title: '导入目标',
              cards: [
                {
                  slug: movedSlug,
                  name: '挪走的卡',
                  rarity: 'common',
                  attributes: {},
                },
              ],
            },
          ],
        },
        adminToken,
      );
      expect(imported.status).toBe(200);

      const dest = await prisma.series.findUnique({ where: { slug: destSlug } });
      const moved = await prisma.card.findUnique({ where: { slug: movedSlug } });
      expect(moved?.seriesId).toBe(dest?.id);
      expect(moved?.subsetId).toBeNull();

      const detail = await get('series.bySlug', { slug: destSlug });
      expect(detail.status).toBe(200);
      const body = resultData(detail.body);
      const subsets = body.subsets as Array<{ slug: string }>;
      expect(subsets.map((subset) => subset.slug)).toEqual(['b-base']);
      const cards = body.cards as Array<{ slug: string; subsetSlug: string | null }>;
      expect(cards.find((card) => card.slug === movedSlug)?.subsetSlug).toBeNull();
    } finally {
      await prisma.card.deleteMany({ where: { slug: movedSlug } });
      await prisma.series.deleteMany({ where: { slug: { in: [sourceSlug, destSlug] } } });
    }
  });
});
