import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SUBSETS_PER_SERIES_MAX } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (!isRecord(body) || !isRecord(body.result)) throw new Error('expected tRPC result');
  const data = body.result.data;
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

function subsetList({ count, prefix }: { count: number; prefix: string }) {
  return Array.from({ length: count }, (_, index) => ({
    slug: `${prefix}-${index + 1}`,
    name: `子集 ${index + 1}`,
    kind: index === 0 ? 'BASE' : 'INSERT',
    sortOrder: index,
  }));
}

describe('catalog import hardening (批量导入加固)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const adminEmail = `harden-admin-${suffix}@cardhub.test`;
  let adminToken = '';
  const slug = (name: string) => `${name}-${suffix}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const registered = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.240')
      .send({
        email: adminEmail,
        username: `hadm${suffix}`.slice(0, 24),
        password: 'import-password',
      });
    expect(registered.status).toBe(200);
    const result: unknown = registered.body?.result?.data;
    if (!isRecord(result) || typeof result.token !== 'string') throw new Error('expected token');
    adminToken = result.token;
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'admin' } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.card.deleteMany({ where: { slug: { contains: suffix } } });
      await prisma.series.deleteMany({ where: { slug: { contains: suffix } } });
      await prisma.user.deleteMany({ where: { email: adminEmail } });
    }
    await app?.close();
  });

  function importCatalog({ data, dryRun }: { data: unknown; dryRun: boolean }) {
    return request(app.getHttpServer())
      .post('/trpc/admin.catalog.import')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.241')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dryRun, data });
  }

  async function ownedCounts() {
    const [series, cards, subsets] = await Promise.all([
      prisma.series.count({ where: { slug: { contains: suffix } } }),
      prisma.card.count({ where: { slug: { contains: suffix } } }),
      prisma.subset.count({ where: { series: { slug: { contains: suffix } } } }),
    ]);
    return { series, cards, subsets };
  }

  it('rejects an impossible release date (2026-02-30) and names the series row it came from', async () => {
    const data = [
      { slug: slug('date-ok'), title: '日期正常', releaseDate: '2026-02-28' },
      { slug: slug('date-bad'), title: '日期不存在', releaseDate: '2026-02-30' },
    ];
    const preview = await importCatalog({ data, dryRun: true });
    expect(preview.status).toBe(200);
    const rows = rowsOf(preview.body);
    expect(rows.map((row) => [row.row.row, row.row.slug, row.status, row.errors])).toEqual([
      [1, slug('date-ok'), 'created', []],
      [2, slug('date-bad'), 'error', [{ path: 'series[1].releaseDate', code: 'INVALID_DATE' }]],
    ]);

    const before = await ownedCounts();
    const forced = await importCatalog({ data, dryRun: false });
    expect(forced.status).toBe(400);
    const bad = errorRowsOf(forced.body).find((row) => row.status === 'error');
    expect(bad?.row).toEqual({ row: 2, type: 'series', slug: slug('date-bad') });
    expect(bad?.errors).toEqual([{ path: 'series[1].releaseDate', code: 'INVALID_DATE' }]);
    expect(await ownedCounts()).toEqual(before);
  });

  it('two series with a same-slug base subset: each card lands in the base subset of its own series', async () => {
    const data = [
      {
        slug: slug('twin-a'),
        title: '系列甲',
        subsets: [{ slug: 'base', name: '甲基础', kind: 'BASE' }],
        cards: [{ slug: slug('twin-a-001'), name: '甲一', rarity: 'common', subsetSlug: 'base' }],
      },
      {
        slug: slug('twin-b'),
        title: '系列乙',
        subsets: [{ slug: 'base', name: '乙基础', kind: 'BASE' }],
        cards: [{ slug: slug('twin-b-001'), name: '乙一', rarity: 'common', subsetSlug: 'base' }],
      },
    ];
    const imported = await importCatalog({ data, dryRun: false });
    expect(imported.status).toBe(200);
    expect(rowsOf(imported.body).map((row) => row.status)).toEqual([
      'created',
      'created',
      'created',
      'created',
    ]);

    // A later file names only the stored series: the subset comes from the database.
    const later = [
      {
        slug: slug('twin-b'),
        title: '系列乙',
        cards: [{ slug: slug('twin-b-002'), name: '乙二', rarity: 'common', subsetSlug: 'base' }],
      },
    ];
    const second = await importCatalog({ data: later, dryRun: false });
    expect(second.status).toBe(200);

    const cards = await prisma.card.findMany({
      where: { slug: { in: [slug('twin-a-001'), slug('twin-b-001'), slug('twin-b-002')] } },
      orderBy: { slug: 'asc' },
      select: {
        slug: true,
        series: { select: { slug: true } },
        subset: { select: { slug: true, name: true, series: { select: { slug: true } } } },
      },
    });
    expect(
      cards.map((card) => [
        card.slug,
        card.series.slug,
        card.subset?.series.slug,
        card.subset?.name,
      ]),
    ).toEqual([
      [slug('twin-a-001'), slug('twin-a'), slug('twin-a'), '甲基础'],
      [slug('twin-b-001'), slug('twin-b'), slug('twin-b'), '乙基础'],
      [slug('twin-b-002'), slug('twin-b'), slug('twin-b'), '乙基础'],
    ]);
  });

  describe(`CH-236 subsets per series: at most ${SUBSETS_PER_SERIES_MAX}`, () => {
    async function seedEighteen(seriesSlug: string) {
      const seeded = await importCatalog({
        data: [
          {
            slug: seriesSlug,
            title: '已有十八个',
            subsets: subsetList({ count: 18, prefix: 'old' }),
          },
        ],
        dryRun: false,
      });
      expect(seeded.status).toBe(200);
    }

    it('AC7-2 / 36-3: 18 stored + 3 new slugs fails the series row at series[0].subsets; dryRun:false is 400 and no table changes', async () => {
      const seriesSlug = slug('subsets-18');
      await seedEighteen(seriesSlug);

      const data = [
        { slug: seriesSlug, title: '已有十八个', subsets: subsetList({ count: 3, prefix: 'new' }) },
      ];
      const preview = await importCatalog({ data, dryRun: true });
      expect(preview.status).toBe(200);
      expect(rowsOf(preview.body).map((row) => [row.row.slug, row.status, row.errors])).toEqual([
        [seriesSlug, 'error', [{ path: 'series[0].subsets', code: 'TOO_MANY_SUBSETS' }]],
      ]);

      const before = await ownedCounts();
      const forced = await importCatalog({ data, dryRun: false });
      expect(forced.status).toBe(400);
      expect(errorRowsOf(forced.body)[0]?.errors).toEqual([
        { path: 'series[0].subsets', code: 'TOO_MANY_SUBSETS' },
      ]);
      expect(JSON.stringify(forced.body)).not.toContain('Prisma');
      expect(await ownedCounts()).toEqual(before);
      expect(await prisma.subset.count({ where: { series: { slug: seriesSlug } } })).toBe(18);
    });

    it('AC7-2 / 36-4: 18 stored + 3 listed with 1 relisted slug is 20 after dedupe and imports', async () => {
      const seriesSlug = slug('subsets-18-dedupe');
      await seedEighteen(seriesSlug);
      const data = [
        {
          slug: seriesSlug,
          title: '已有十八个',
          subsets: [
            ...subsetList({ count: 1, prefix: 'old' }),
            ...subsetList({ count: 2, prefix: 'new' }),
          ],
        },
      ];
      const preview = await importCatalog({ data, dryRun: true });
      expect(rowsOf(preview.body).map((row) => [row.status, row.errors])).toEqual([
        ['updated', []],
      ]);
      const imported = await importCatalog({ data, dryRun: false });
      expect(imported.status).toBe(200);
      expect(await prisma.subset.count({ where: { series: { slug: seriesSlug } } })).toBe(20);
    });

    it('a new series listing exactly 20 subsets previews as created and imports', async () => {
      const data = [
        {
          slug: slug('subsets-20'),
          title: '二十个子集',
          subsets: subsetList({ count: 20, prefix: 's' }),
        },
      ];
      const preview = await importCatalog({ data, dryRun: true });
      expect(rowsOf(preview.body).map((row) => [row.status, row.errors])).toEqual([
        ['created', []],
      ]);
      const imported = await importCatalog({ data, dryRun: false });
      expect(imported.status).toBe(200);
      expect(await prisma.subset.count({ where: { series: { slug: slug('subsets-20') } } })).toBe(
        20,
      );
    });

    it('36-4: a new series listing 21 subsets fails its row, the neighbour row is fine, and dryRun:false writes nothing', async () => {
      const data = [
        { slug: slug('neighbour'), title: '正常系列' },
        {
          slug: slug('subsets-21'),
          title: '二十一个子集',
          subsets: subsetList({ count: 21, prefix: 's' }),
        },
      ];
      const preview = await importCatalog({ data, dryRun: true });
      expect(preview.status).toBe(200);
      expect(rowsOf(preview.body).map((row) => [row.status, row.errors])).toEqual([
        ['created', []],
        ['error', [{ path: 'series[1].subsets', code: 'TOO_MANY_SUBSETS' }]],
      ]);
      const before = await ownedCounts();
      const forced = await importCatalog({ data, dryRun: false });
      expect(forced.status).toBe(400);
      expect(await ownedCounts()).toEqual(before);
    });
  });

  describe('CH-236 whitespace-only releaseDate and cardNumber', () => {
    const seriesSlug = slug('blank');
    const cardSlug = slug('blank-card');

    async function restoreStored() {
      const seeded = await importCatalog({
        data: [
          {
            slug: seriesSlug,
            title: '空白字段',
            releaseDate: '2026-08-01',
            cards: [{ slug: cardSlug, name: '卡', rarity: 'common', cardNumber: '001' }],
          },
        ],
        dryRun: false,
      });
      expect(seeded.status).toBe(200);
    }

    function file({ releaseDate, cardNumber }: { releaseDate?: string; cardNumber?: string }) {
      return [
        {
          slug: seriesSlug,
          title: '空白字段',
          ...(releaseDate !== undefined ? { releaseDate } : {}),
          cards: [
            {
              slug: cardSlug,
              name: '卡',
              rarity: 'common',
              ...(cardNumber !== undefined ? { cardNumber } : {}),
            },
          ],
        },
      ];
    }

    async function publicValues() {
      const detail = await request(app.getHttpServer())
        .get('/trpc/series.bySlug')
        .query({ input: JSON.stringify({ slug: seriesSlug }) })
        .set('X-Forwarded-For', '203.0.113.242');
      expect(detail.status).toBe(200);
      const series: unknown = detail.body?.result?.data;
      if (!isRecord(series) || !Array.isArray(series.cards)) throw new Error('expected series');
      const card = series.cards.filter(isRecord).find((item) => item.slug === cardSlug);
      return { releaseDate: series.releaseDate, cardNumber: card?.cardNumber };
    }

    it('AC7-1 / 36-1: releaseDate "   " and cardNumber "  " preview as updated and clear both; omitting them keeps stored values', async () => {
      await restoreStored();
      const blank = file({ releaseDate: '   ', cardNumber: '  ' });
      const preview = await importCatalog({ data: blank, dryRun: true });
      expect(preview.status).toBe(200);
      expect(rowsOf(preview.body).map((row) => [row.row.type, row.status, row.errors])).toEqual([
        ['series', 'updated', []],
        ['card', 'updated', []],
      ]);
      // Same preview as the empty string, which already meant "clear".
      const empty = await importCatalog({
        data: file({ releaseDate: '', cardNumber: '' }),
        dryRun: true,
      });
      expect(rowsOf(preview.body)).toEqual(rowsOf(empty.body));

      const imported = await importCatalog({ data: blank, dryRun: false });
      expect(imported.status).toBe(200);
      expect(await publicValues()).toEqual({ releaseDate: null, cardNumber: null });
      const stored = await prisma.card.findUniqueOrThrow({ where: { slug: cardSlug } });
      expect(stored.cardNumberNormalized).toBeNull();

      await restoreStored();
      const omitted = await importCatalog({ data: file({}), dryRun: true });
      expect(rowsOf(omitted.body).map((row) => row.status)).toEqual(['unchanged', 'unchanged']);
      const kept = await importCatalog({ data: file({}), dryRun: false });
      expect(kept.status).toBe(200);
      expect(await publicValues()).toEqual({ releaseDate: '2026-08-01', cardNumber: '001' });
    });

    it('other whitespace (tab, U+3000) clears the same way', async () => {
      await restoreStored();
      const imported = await importCatalog({
        data: file({ releaseDate: '\t\u3000 ', cardNumber: '\u3000\t' }),
        dryRun: false,
      });
      expect(imported.status).toBe(200);
      expect(await publicValues()).toEqual({ releaseDate: null, cardNumber: null });
    });

    it('36-2: " 2026-08-01 " is stored as 2026-08-01; "2026-8-1" is still INVALID_DATE', async () => {
      await restoreStored();
      const padded = await importCatalog({
        data: file({ releaseDate: ' 2026-08-01 ' }),
        dryRun: false,
      });
      expect(padded.status).toBe(200);
      expect((await publicValues()).releaseDate).toBe('2026-08-01');

      const loose = await importCatalog({ data: file({ releaseDate: '2026-8-1' }), dryRun: true });
      expect(rowsOf(loose.body)[0]?.errors).toEqual([
        { path: 'series[0].releaseDate', code: 'INVALID_DATE' },
      ]);
    });
  });
});
