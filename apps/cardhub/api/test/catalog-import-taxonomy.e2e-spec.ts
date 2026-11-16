import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { normalizedCardNumber } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { CATALOG_SERIES } from '../src/scripts/seed-data';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.result)) throw new Error('expected tRPC result');
  return body.result.data;
}

interface Row {
  row: { row: number; type: string; slug: string | null };
  status: string;
  errors: Array<{ path: string; code: string }>;
}

function toRow(value: unknown): Row {
  if (!isRecord(value) || !isRecord(value.row) || !Array.isArray(value.errors)) {
    throw new Error('expected import row');
  }
  const row = value.row;
  return {
    row: {
      row: typeof row.row === 'number' ? row.row : -1,
      type: typeof row.type === 'string' ? row.type : '',
      slug: typeof row.slug === 'string' ? row.slug : null,
    },
    status: typeof value.status === 'string' ? value.status : '',
    errors: value.errors.filter(isRecord).map((error) => ({
      path: typeof error.path === 'string' ? error.path : '',
      code: typeof error.code === 'string' ? error.code : '',
    })),
  };
}

function rowsOf(body: unknown): Row[] {
  const data = resultData(body);
  if (!Array.isArray(data)) throw new Error('expected rows');
  return data.map(toRow);
}

function errorRowsOf(body: unknown): Row[] {
  if (!isRecord(body) || !isRecord(body.error) || !isRecord(body.error.data)) {
    throw new Error('expected tRPC error');
  }
  const admin = body.error.data.adminCatalogError;
  if (!isRecord(admin) || !Array.isArray(admin.rows)) throw new Error('expected error rows');
  return admin.rows.map(toRow);
}

function assertNoInternalText(body: unknown): void {
  let serialized = JSON.stringify(body);
  if (isRecord(body) && isRecord(body.error) && isRecord(body.error.data)) {
    const data = { ...body.error.data };
    delete data.stack;
    serialized = JSON.stringify({ ...body, error: { ...body.error, data } });
  }
  for (const text of [
    'Prisma',
    'prisma',
    'invocation',
    'node_modules',
    'Unrecognized key',
    'Invalid enum',
    'Expected',
    'ZodError',
    'invalid_date',
    'unrecognized_keys',
  ]) {
    expect(serialized).not.toContain(text);
  }
}

describe('catalog import taxonomy (CH-234)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const adminEmail = `tax-admin-${suffix}@cardhub.test`;
  let adminToken = '';
  const slug = (name: string) => `${name}-${suffix}`;
  const categorySlug = slug('ptcg-sc');
  const seedCategorySlug = slug('seed-cat');

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const registered = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.230')
      .send({
        email: adminEmail,
        username: `tadm${suffix}`.slice(0, 24),
        password: 'import-password',
      });
    expect(registered.status).toBe(200);
    const token = resultData(registered.body);
    if (!isRecord(token) || typeof token.token !== 'string') throw new Error('expected token');
    adminToken = token.token;
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'admin' } });
    await prisma.category.createMany({
      data: [
        { slug: categorySlug, name: '宝可梦卡牌（简中）' },
        { slug: seedCategorySlug, name: '构筑对战' },
      ],
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.card.deleteMany({ where: { slug: { contains: suffix } } });
      await prisma.series.deleteMany({ where: { slug: { contains: suffix } } });
      await prisma.category.deleteMany({ where: { slug: { contains: suffix } } });
      await prisma.user.deleteMany({ where: { email: adminEmail } });
    }
    await app?.close();
  });

  function post(path: string, body: unknown) {
    return request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.231')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  function get(path: string, input: unknown) {
    return request(app.getHttpServer())
      .get(`/trpc/${path}`)
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.232');
  }

  // Other e2e suites write to the same database in parallel, so count the
  // rows this suite owns (every slug carries the suffix).
  async function tableCounts() {
    const [series, cards, subsets] = await Promise.all([
      prisma.series.count({ where: { slug: { contains: suffix } } }),
      prisma.card.count({ where: { slug: { contains: suffix } } }),
      prisma.subset.count({ where: { series: { slug: { contains: suffix } } } }),
    ]);
    return { series, cards, subsets };
  }

  function taxonomyFile() {
    return [
      {
        slug: slug('csv10-5'),
        title: '黑雷奔流',
        categorySlug,
        releaseDate: '2026-09-12',
        subsets: [
          { slug: 'base', name: '基础卡', kind: 'BASE', sortOrder: 0 },
          { slug: 'sar', name: '特别插画', kind: 'INSERT', sortOrder: 1 },
        ],
        cards: [
          {
            slug: slug('pikachu'),
            name: '皮卡丘',
            rarity: 'common',
            attributes: { 稀有度: 'C' },
            cardNumber: '001/174',
            subsetSlug: 'base',
          },
          {
            slug: slug('raichu'),
            name: '雷丘',
            rarity: 'rare',
            cardNumber: '010/174',
            subsetSlug: 'base',
          },
          {
            slug: slug('pikachu-sar'),
            name: '皮卡丘',
            rarity: 'legendary',
            cardNumber: '175/174',
            subsetSlug: 'sar',
          },
        ],
      },
    ];
  }

  it('AC6-1: new taxonomy fields preview as created, import, read back, then preview unchanged', async () => {
    const preview = await post('admin.catalog.import', { dryRun: true, data: taxonomyFile() });
    expect(preview.status).toBe(200);
    const previewRows = rowsOf(preview.body);
    expect(previewRows).toHaveLength(4);
    expect(previewRows.map((row) => [row.status, row.errors])).toEqual(
      previewRows.map(() => ['created', []]),
    );

    const imported = await post('admin.catalog.import', { dryRun: false, data: taxonomyFile() });
    expect(imported.status).toBe(200);
    expect(rowsOf(imported.body).every((row) => row.status === 'created')).toBe(true);

    const detail = await get('series.bySlug', { slug: slug('csv10-5') });
    expect(detail.status).toBe(200);
    const series = resultData(detail.body);
    if (!isRecord(series) || !Array.isArray(series.cards)) throw new Error('expected series');
    expect(series.category).toEqual({ slug: categorySlug, name: '宝可梦卡牌（简中）' });
    expect(series.releaseDate).toBe('2026-09-12');
    expect(series.subsets).toEqual([
      { slug: 'base', name: '基础卡', kind: 'BASE', sortOrder: 0 },
      { slug: 'sar', name: '特别插画', kind: 'INSERT', sortOrder: 1 },
    ]);
    const bySubset = new Map<string, string[]>();
    for (const card of series.cards.filter(isRecord)) {
      const key = typeof card.subsetSlug === 'string' ? card.subsetSlug : '(none)';
      bySubset.set(key, [...(bySubset.get(key) ?? []), String(card.cardNumber)]);
    }
    expect(Object.fromEntries(bySubset)).toEqual({
      base: ['001/174', '010/174'],
      sar: ['175/174'],
    });
    const stored = await prisma.card.findUnique({ where: { slug: slug('raichu') } });
    expect(stored?.cardNumberNormalized).toBe(normalizedCardNumber('010/174'));

    const again = await post('admin.catalog.import', { dryRun: true, data: taxonomyFile() });
    expect(again.status).toBe(200);
    expect(rowsOf(again.body).map((row) => row.status)).toEqual([
      'unchanged',
      'unchanged',
      'unchanged',
      'unchanged',
    ]);
  });

  it('AC6-1: a changed subset name, release date or card number previews as updated and is written', async () => {
    const file = taxonomyFile();
    const first = file[0]!;
    first.releaseDate = '2026-09-19';
    first.subsets[1] = { slug: 'sar', name: '特别稀有插画', kind: 'INSERT', sortOrder: 2 };
    first.cards[1] = { ...first.cards[1]!, cardNumber: '011/174', subsetSlug: 'sar' };
    const preview = await post('admin.catalog.import', { dryRun: true, data: file });
    expect(preview.status).toBe(200);
    expect(rowsOf(preview.body).map((row) => row.status)).toEqual([
      'updated',
      'unchanged',
      'updated',
      'unchanged',
    ]);
    const imported = await post('admin.catalog.import', { dryRun: false, data: file });
    expect(imported.status).toBe(200);
    const series = await prisma.series.findUnique({
      where: { slug: slug('csv10-5') },
      include: { subsets: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(series?.releaseDate?.toISOString().slice(0, 10)).toBe('2026-09-19');
    expect(series?.subsets.map((subset) => [subset.slug, subset.name, subset.sortOrder])).toEqual([
      ['base', '基础卡', 0],
      ['sar', '特别稀有插画', 2],
    ]);
    const raichu = await prisma.card.findUnique({
      where: { slug: slug('raichu') },
      include: { subset: true },
    });
    expect(raichu?.cardNumber).toBe('011/174');
    expect(raichu?.subset?.slug).toBe('sar');
  });

  it('AC6-1: a card may use a subset that already exists on the series without listing it again', async () => {
    const data = [
      {
        slug: slug('csv10-5'),
        title: '黑雷奔流',
        cards: [
          {
            slug: slug('zapdos'),
            name: '闪电鸟',
            rarity: 'epic',
            cardNumber: '050/174',
            subsetSlug: 'base',
          },
        ],
      },
    ];
    const imported = await post('admin.catalog.import', { dryRun: false, data });
    expect(imported.status).toBe(200);
    expect(rowsOf(imported.body).map((row) => row.status)).toEqual(['unchanged', 'created']);
    const zapdos = await prisma.card.findUnique({
      where: { slug: slug('zapdos') },
      include: { subset: true },
    });
    expect(zapdos?.subset?.slug).toBe('base');
  });

  it('empty strings clear category, release date, card number and subset; unlisted subsets stay', async () => {
    const data = [
      {
        slug: slug('csv10-5'),
        title: '黑雷奔流',
        categorySlug: '',
        releaseDate: '',
        subsets: [],
        cards: [
          {
            slug: slug('zapdos'),
            name: '闪电鸟',
            rarity: 'epic',
            cardNumber: '  ',
            subsetSlug: '',
          },
        ],
      },
    ];
    const preview = await post('admin.catalog.import', { dryRun: true, data });
    expect(rowsOf(preview.body).map((row) => row.status)).toEqual(['updated', 'updated']);
    const imported = await post('admin.catalog.import', { dryRun: false, data });
    expect(imported.status).toBe(200);
    const series = await prisma.series.findUnique({
      where: { slug: slug('csv10-5') },
      include: { subsets: true },
    });
    expect(series?.categoryId).toBeNull();
    expect(series?.releaseDate).toBeNull();
    expect(series?.subsets).toHaveLength(2);
    const zapdos = await prisma.card.findUnique({ where: { slug: slug('zapdos') } });
    expect(zapdos?.cardNumber).toBeNull();
    expect(zapdos?.cardNumberNormalized).toBeNull();
    expect(zapdos?.subsetId).toBeNull();
    const again = await post('admin.catalog.import', { dryRun: true, data });
    expect(rowsOf(again.body).map((row) => row.status)).toEqual(['unchanged', 'unchanged']);
  });

  it('AC6-2: each bad row gets its own code, dryRun:false is 400 and series, cards and subsets do not change', async () => {
    const data = [
      {
        slug: slug('bad-category'),
        title: '品类不存在',
        categorySlug: slug('no-such-category'),
      },
      {
        slug: slug('bad-date'),
        title: '日期不存在',
        releaseDate: '2026-13-01',
      },
      {
        slug: slug('bad-cards'),
        title: '坏卡',
        subsets: [{ slug: 'base', name: '基础卡', kind: 'BASE', sortOrder: 0 }],
        cards: [
          {
            slug: slug('bad-subset'),
            name: '子集不存在',
            rarity: 'common',
            subsetSlug: 'nowhere',
          },
          {
            slug: slug('bad-number'),
            name: '卡号太长',
            rarity: 'common',
            cardNumber: '1'.repeat(21),
          },
          {
            slug: slug('bad-field'),
            name: '字段写错',
            rarity: 'common',
            cardNo: '001',
          },
          {
            slug: slug('good-card'),
            name: '正常卡',
            rarity: 'common',
            cardNumber: '1'.repeat(20),
            subsetSlug: 'base',
          },
        ],
      },
    ];

    const preview = await post('admin.catalog.import', { dryRun: true, data });
    expect(preview.status).toBe(200);
    assertNoInternalText(preview.body);
    const bySlug = new Map(rowsOf(preview.body).map((row) => [row.row.slug, row]));
    expect(bySlug.get(slug('bad-category'))?.errors).toEqual([
      { path: 'series[0].categorySlug', code: 'CATEGORY_NOT_FOUND' },
    ]);
    expect(bySlug.get(slug('bad-date'))?.errors).toEqual([
      { path: 'series[1].releaseDate', code: 'INVALID_DATE' },
    ]);
    expect(bySlug.get(slug('bad-subset'))?.errors).toEqual([
      { path: 'series[2].cards[0].subsetSlug', code: 'SUBSET_NOT_FOUND' },
    ]);
    expect(bySlug.get(slug('bad-number'))?.errors).toEqual([
      { path: 'series[2].cards[1].cardNumber', code: 'TOO_LONG' },
    ]);
    expect(bySlug.get(slug('bad-field'))?.errors).toEqual([
      { path: 'series[2].cards[2].cardNo', code: 'UNKNOWN_FIELD' },
    ]);
    for (const name of ['bad-category', 'bad-date', 'bad-subset', 'bad-number', 'bad-field']) {
      expect(bySlug.get(slug(name))?.status).toBe('error');
    }
    expect(bySlug.get(slug('bad-cards'))?.status).toBe('created');
    expect(bySlug.get(slug('good-card'))?.status).toBe('created');

    const before = await tableCounts();
    const forced = await post('admin.catalog.import', { dryRun: false, data });
    expect(forced.status).toBe(400);
    expect(forced.body.error.data.code).toBe('BAD_REQUEST');
    expect(forced.body.error.message).toBe('导入数据校验失败');
    const forcedCodes = errorRowsOf(forced.body).flatMap((row) =>
      row.errors.map((error) => error.code),
    );
    expect(forcedCodes.sort()).toEqual(
      [
        'CATEGORY_NOT_FOUND',
        'INVALID_DATE',
        'SUBSET_NOT_FOUND',
        'TOO_LONG',
        'UNKNOWN_FIELD',
      ].sort(),
    );
    assertNoInternalText(forced.body);
    expect(await tableCounts()).toEqual(before);
    expect(await prisma.series.findUnique({ where: { slug: slug('bad-cards') } })).toBeNull();
  });

  it('AC6-2: a bad row next to a parallel still rolls back every table on dryRun:false', async () => {
    const data = [
      {
        slug: slug('par-bad'),
        title: '平行加坏行',
        subsets: [{ slug: 'base', name: '基础卡', kind: 'BASE' }],
        cards: [
          { slug: slug('par-base'), name: '基础', rarity: 'common', subsetSlug: 'base' },
          {
            slug: slug('par-foil'),
            name: '闪',
            rarity: 'rare',
            parallelOf: slug('par-base'),
            parallelName: '闪',
          },
          { slug: slug('par-wrong'), name: '坏', rarity: 'common', subsetSlug: 'missing' },
        ],
      },
    ];
    const before = await tableCounts();
    const forced = await post('admin.catalog.import', { dryRun: false, data });
    expect(forced.status).toBe(400);
    const wrong = errorRowsOf(forced.body).find((row) => row.row.slug === slug('par-wrong'));
    expect(wrong?.errors).toEqual([
      { path: 'series[0].cards[2].subsetSlug', code: 'SUBSET_NOT_FOUND' },
    ]);
    assertNoInternalText(forced.body);
    expect(await tableCounts()).toEqual(before);
  });

  it('reports unknown and malformed fields on series, subsets and cards', async () => {
    const preview = await post('admin.catalog.import', {
      dryRun: true,
      data: [
        {
          slug: slug('shape'),
          title: '格式',
          releaseDate: '2026/09/12',
          categorySlug: 'Not A Slug',
          seriesCode: 'CSV10.5',
          subsets: [
            { slug: 'base', name: '基础卡', kind: 'MAIN', sortOrder: 1.5, label: 'x' },
            { slug: 'base', name: '重复', kind: 'BASE' },
            'nope',
          ],
          cards: [
            {
              slug: slug('shape-card'),
              name: '卡',
              rarity: 'common',
              cardNumber: 12,
              subsetSlug: 'Bad Slug',
              body: '招式文本',
            },
          ],
        },
      ],
    });
    expect(preview.status).toBe(200);
    assertNoInternalText(preview.body);
    const [series, card] = rowsOf(preview.body);
    expect(series?.errors).toEqual([
      { path: 'series[0].seriesCode', code: 'UNKNOWN_FIELD' },
      { path: 'series[0].categorySlug', code: 'SLUG_FORMAT' },
      { path: 'series[0].releaseDate', code: 'INVALID_DATE' },
      { path: 'series[0].subsets[0].label', code: 'UNKNOWN_FIELD' },
      { path: 'series[0].subsets[0].kind', code: 'INVALID_TYPE' },
      { path: 'series[0].subsets[0].sortOrder', code: 'INVALID_TYPE' },
      { path: 'series[0].subsets[1].slug', code: 'SLUG_DUPLICATE_IN_FILE' },
      { path: 'series[0].subsets[2]', code: 'INVALID_TYPE' },
    ]);
    expect(card?.errors).toEqual([
      { path: 'series[0].cards[0].body', code: 'UNKNOWN_FIELD' },
      { path: 'series[0].cards[0].cardNumber', code: 'INVALID_TYPE' },
      { path: 'series[0].cards[0].subsetSlug', code: 'SLUG_FORMAT' },
    ]);
  });

  it('subset errors (bad kind, duplicate slug) block dryRun:false with 400 and write nothing', async () => {
    const data = [
      {
        slug: slug('subset-bad'),
        title: '子集出错',
        subsets: [
          { slug: 'base', name: '基础卡', kind: 'MAIN' },
          { slug: 'ar', name: 'AR', kind: 'INSERT' },
          { slug: 'ar', name: 'AR 重复', kind: 'INSERT' },
        ],
        cards: [{ slug: slug('subset-bad-card'), name: '卡', rarity: 'common' }],
      },
    ];
    const preview = await post('admin.catalog.import', { dryRun: true, data });
    const [series] = rowsOf(preview.body);
    expect(series?.status).toBe('error');
    expect(series?.errors).toEqual([
      { path: 'series[0].subsets[0].kind', code: 'INVALID_TYPE' },
      { path: 'series[0].subsets[2].slug', code: 'SLUG_DUPLICATE_IN_FILE' },
    ]);
    const before = await tableCounts();
    const forced = await post('admin.catalog.import', { dryRun: false, data });
    expect(forced.status).toBe(400);
    expect(errorRowsOf(forced.body)[0]?.errors.map((error) => error.code)).toEqual([
      'INVALID_TYPE',
      'SLUG_DUPLICATE_IN_FILE',
    ]);
    assertNoInternalText(forced.body);
    expect(await tableCounts()).toEqual(before);
  });

  it('AC6-4: the old seed format previews unchanged and keeps category, date, subsets and card numbers', async () => {
    const seedSlug = (value: string) => `${value}-${suffix}`;
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: seedCategorySlug } });
    for (const series of CATALOG_SERIES) {
      const saved = await prisma.series.create({
        data: {
          slug: seedSlug(series.slug),
          title: series.title,
          description: series.description,
          coverUrl: series.coverUrl,
          categoryId: category.id,
          releaseDate: series.releaseDate ? new Date(`${series.releaseDate}T00:00:00.000Z`) : null,
        },
      });
      const subsetIds = new Map<string, string>();
      for (const subset of series.subsets) {
        const created = await prisma.subset.create({
          data: { seriesId: saved.id, ...subset },
        });
        subsetIds.set(subset.slug, created.id);
      }
      for (const card of series.cards) {
        await prisma.card.create({
          data: {
            slug: seedSlug(card.slug),
            name: card.name,
            description: card.description,
            imageUrl: card.imageUrl,
            rarity: card.rarity,
            attributes: card.attributes,
            seriesId: saved.id,
            cardNumber: card.cardNumber ?? null,
            cardNumberNormalized: normalizedCardNumber(card.cardNumber ?? null),
            subsetId: card.subsetSlug ? (subsetIds.get(card.subsetSlug) ?? null) : null,
          },
        });
      }
    }
    const legacy = CATALOG_SERIES.map((series) => ({
      slug: seedSlug(series.slug),
      title: series.title,
      description: series.description,
      coverUrl: series.coverUrl,
      cards: series.cards.map((card) => ({
        slug: seedSlug(card.slug),
        name: card.name,
        description: card.description,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        attributes: card.attributes,
      })),
    }));
    expect(legacy).toHaveLength(3);
    expect(legacy.flatMap((series) => series.cards)).toHaveLength(9);

    const snapshot = async () => {
      const rows = await prisma.series.findMany({
        where: { slug: { in: legacy.map((series) => series.slug) } },
        orderBy: { slug: 'asc' },
        select: {
          slug: true,
          categoryId: true,
          releaseDate: true,
          subsets: {
            orderBy: { slug: 'asc' },
            select: { slug: true, name: true, kind: true, sortOrder: true },
          },
          cards: {
            orderBy: { slug: 'asc' },
            select: { slug: true, cardNumber: true, cardNumberNormalized: true, subsetId: true },
          },
        },
      });
      return JSON.stringify(rows);
    };
    const before = await snapshot();

    const preview = await post('admin.catalog.import', { dryRun: true, data: legacy });
    expect(preview.status).toBe(200);
    const rows = rowsOf(preview.body);
    expect(rows).toHaveLength(12);
    expect(rows.filter((row) => row.status !== 'unchanged')).toEqual([]);

    const imported = await post('admin.catalog.import', { dryRun: false, data: legacy });
    expect(imported.status).toBe(200);
    expect(rowsOf(imported.body).every((row) => row.status === 'unchanged')).toBe(true);
    expect(await snapshot()).toBe(before);
    const kept = await prisma.card.findMany({
      where: { slug: { in: legacy.flatMap((series) => series.cards.map((card) => card.slug)) } },
    });
    expect(kept.every((card) => card.cardNumber !== null && card.subsetId !== null)).toBe(true);
  });

  it('imports 500 rows with two subsets inside the 20s transaction', async () => {
    const cards = Array.from({ length: 499 }, (_, index) => ({
      slug: slug(`bulk-${index}`),
      name: `批量卡 ${index}`,
      rarity: 'common',
      attributes: { 稀有度: 'C', HP: 60 },
      cardNumber: `${String(index + 1).padStart(3, '0')}/499`,
      subsetSlug: index % 5 === 0 ? 'ar' : 'base',
    }));
    const file = (title: string) => [
      {
        slug: slug('bulk'),
        title,
        categorySlug,
        releaseDate: '2026-10-17',
        subsets: [
          { slug: 'base', name: '基础卡', kind: 'BASE', sortOrder: 0 },
          { slug: 'ar', name: 'AR', kind: 'INSERT', sortOrder: 1 },
        ],
        cards,
      },
    ];
    const timings: Record<string, number> = {};
    for (const [label, dryRun, title] of [
      ['preview-create', true, '批量'],
      ['import-create', false, '批量'],
      ['preview-unchanged', true, '批量'],
      ['import-update', false, '批量改名'],
    ] as const) {
      const started = Date.now();
      const response = await post('admin.catalog.import', { dryRun, data: file(title) });
      timings[label] = Date.now() - started;
      expect(response.status).toBe(200);
      expect(rowsOf(response.body)).toHaveLength(500);
    }
    // Evidence for the PR. The transaction cap is 20s (admin.router.ts IMPORT_TRANSACTION_TIMEOUT_MS).
    process.stdout.write(`CH-234 500-row timings ms: ${JSON.stringify(timings)}\n`);
    expect(Math.max(...Object.values(timings))).toBeLessThan(20_000);
    expect(
      await prisma.card.count({ where: { series: { slug: slug('bulk') }, subsetId: null } }),
    ).toBe(0);
  });
});
