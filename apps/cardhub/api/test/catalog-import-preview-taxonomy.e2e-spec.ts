import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { CATALOG_SERIES } from '../src/scripts/seed-data';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The raw `row` objects, so a test can tell a missing key from an empty string. */
function rawRows(body: unknown): Array<Record<string, unknown>> {
  if (!isRecord(body) || !isRecord(body.result) || !Array.isArray(body.result.data)) {
    throw new Error('expected tRPC result rows');
  }
  return body.result.data.map((item: unknown) => {
    if (!isRecord(item) || !isRecord(item.row)) throw new Error('expected import row');
    return item.row;
  });
}

function rawErrorRows(body: unknown): Array<Record<string, unknown>> {
  if (!isRecord(body) || !isRecord(body.error) || !isRecord(body.error.data)) {
    throw new Error('expected tRPC error');
  }
  const admin = body.error.data.adminCatalogError;
  if (!isRecord(admin) || !Array.isArray(admin.rows)) throw new Error('expected error rows');
  return admin.rows.map((item: unknown) => {
    if (!isRecord(item) || !isRecord(item.row)) throw new Error('expected import row');
    return item.row;
  });
}

const TAXONOMY_KEYS = ['categorySlug', 'releaseDate', 'subsetSlug', 'cardNumber'];

describe('catalog import preview taxonomy fields (CH-238 / AC7-5)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const adminEmail = `ptax-admin-${suffix}@cardhub.test`;
  const categorySlug = `ptcg-sc-${suffix}`;
  let adminToken = '';
  const slug = (name: string) => `${name}-${suffix}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const registered = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.250')
      .send({
        email: adminEmail,
        username: `ptax${suffix}`.slice(0, 24),
        password: 'import-password',
      });
    expect(registered.status).toBe(200);
    const result: unknown = registered.body?.result?.data;
    if (!isRecord(result) || typeof result.token !== 'string') throw new Error('expected token');
    adminToken = result.token;
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'admin' } });
    await prisma.category.create({ data: { slug: categorySlug, name: '宝可梦卡牌（简中）' } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.card.deleteMany({ where: { slug: { contains: suffix } } });
      await prisma.series.deleteMany({ where: { slug: { contains: suffix } } });
      await prisma.category.deleteMany({ where: { slug: categorySlug } });
      await prisma.user.deleteMany({ where: { email: adminEmail } });
    }
    await app?.close();
  });

  function importCatalog({ data, dryRun }: { data: unknown; dryRun: boolean }) {
    return request(app.getHttpServer())
      .post('/trpc/admin.catalog.import')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.251')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dryRun, data });
  }

  it('AC7-5 / 38-1: series rows return categorySlug and releaseDate, card rows subsetSlug and cardNumber, trimmed like the file', async () => {
    const data = [
      {
        slug: slug('full'),
        title: '四个字段',
        categorySlug,
        releaseDate: ' 2026-09-16 ',
        subsets: [{ slug: 'main', name: '主卡', kind: 'BASE' }],
        cards: [
          {
            slug: slug('full-001'),
            name: '卡一',
            rarity: 'common',
            subsetSlug: 'main',
            cardNumber: '  001 ',
          },
        ],
      },
    ];
    const preview = await importCatalog({ data, dryRun: true });
    expect(preview.status).toBe(200);
    expect(rawRows(preview.body)).toEqual([
      {
        row: 1,
        type: 'series',
        slug: slug('full'),
        name: '四个字段',
        categorySlug,
        releaseDate: '2026-09-16',
      },
      {
        row: 2,
        type: 'card',
        slug: slug('full-001'),
        name: '卡一',
        seriesSlug: slug('full'),
        subsetSlug: 'main',
        cardNumber: '001',
      },
    ]);
  });

  it('AC7-5: omitted fields are absent (undefined), never the stored value', async () => {
    const seeded = await importCatalog({
      data: [
        {
          slug: slug('stored'),
          title: '有存量',
          categorySlug,
          releaseDate: '2026-08-01',
          subsets: [{ slug: 'main', name: '主卡', kind: 'BASE' }],
          cards: [
            {
              slug: slug('stored-001'),
              name: '卡',
              rarity: 'common',
              subsetSlug: 'main',
              cardNumber: '001',
            },
          ],
        },
      ],
      dryRun: false,
    });
    expect(seeded.status).toBe(200);

    const preview = await importCatalog({
      data: [
        {
          slug: slug('stored'),
          title: '有存量',
          cards: [{ slug: slug('stored-001'), name: '卡', rarity: 'common' }],
        },
      ],
      dryRun: true,
    });
    expect(preview.status).toBe(200);
    for (const row of rawRows(preview.body)) {
      for (const key of TAXONOMY_KEYS) expect(row).not.toHaveProperty(key);
    }
  });

  it('AC7-5 × CH-236: "" and whitespace-only both return "" (will clear), distinct from omitted', async () => {
    const preview = await importCatalog({
      data: [
        {
          slug: slug('stored'),
          title: '有存量',
          categorySlug: '',
          releaseDate: '   ',
          cards: [
            {
              slug: slug('stored-001'),
              name: '卡',
              rarity: 'common',
              subsetSlug: '',
              cardNumber: '  ',
            },
            { slug: slug('stored-002'), name: '卡二', rarity: 'common', cardNumber: '\u3000\t' },
          ],
        },
      ],
      dryRun: true,
    });
    expect(preview.status).toBe(200);
    const [series, first, second] = rawRows(preview.body);
    expect(series).toMatchObject({ categorySlug: '', releaseDate: '' });
    expect(first).toMatchObject({ subsetSlug: '', cardNumber: '' });
    expect(second).toMatchObject({ cardNumber: '' });
    expect(second).not.toHaveProperty('subsetSlug');
  });

  it('a value that fails validation is returned as written, next to its row error', async () => {
    const data = [
      {
        slug: slug('bad'),
        title: '坏值',
        releaseDate: '2026-02-30',
        categorySlug: '  ',
        cards: [
          {
            slug: slug('bad-001'),
            name: '卡',
            rarity: 'common',
            cardNumber: '1'.repeat(21),
            subsetSlug: 'nowhere',
          },
        ],
      },
    ];
    const preview = await importCatalog({ data, dryRun: true });
    expect(preview.status).toBe(200);
    if (!isRecord(preview.body) || !isRecord(preview.body.result))
      throw new Error('expected result');
    expect(preview.body.result.data).toEqual([
      expect.objectContaining({
        status: 'error',
        errors: expect.arrayContaining([
          { path: 'series[0].releaseDate', code: 'INVALID_DATE' },
          { path: 'series[0].categorySlug', code: 'SLUG_FORMAT' },
        ]),
      }),
      expect.objectContaining({
        status: 'error',
        errors: expect.arrayContaining([
          { path: 'series[0].cards[0].cardNumber', code: 'TOO_LONG' },
        ]),
      }),
    ]);
    const [series, card] = rawRows(preview.body);
    // Whitespace-only slugs are not cleared (CH-236 only covers releaseDate / cardNumber).
    expect(series).toMatchObject({ releaseDate: '2026-02-30', categorySlug: '  ' });
    expect(card).toMatchObject({ cardNumber: '1'.repeat(21), subsetSlug: 'nowhere' });

    // dryRun:false error rows carry the same fields.
    const forced = await importCatalog({ data, dryRun: false });
    expect(forced.status).toBe(400);
    const [errorSeries, errorCard] = rawErrorRows(forced.body);
    expect(errorSeries).toMatchObject({ releaseDate: '2026-02-30' });
    expect(errorCard).toMatchObject({ cardNumber: '1'.repeat(21), subsetSlug: 'nowhere' });
  });

  it('38-2: the old seed format (3 series, 9 cards, no taxonomy keys) previews with only the old row fields', async () => {
    const data = CATALOG_SERIES.map((series) => ({
      slug: slug(series.slug),
      title: series.title,
      description: series.description,
      coverUrl: series.coverUrl,
      cards: series.cards.map((card) => ({
        slug: slug(card.slug),
        name: card.name,
        description: card.description,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        attributes: card.attributes,
      })),
    }));
    expect(data).toHaveLength(3);
    expect(data.flatMap((series) => series.cards)).toHaveLength(9);
    const preview = await importCatalog({ data, dryRun: true });
    expect(preview.status).toBe(200);
    const rows = rawRows(preview.body);
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        row.type === 'series'
          ? ['name', 'row', 'slug', 'type']
          : ['name', 'row', 'seriesSlug', 'slug', 'type'],
      );
    }
  });
});
