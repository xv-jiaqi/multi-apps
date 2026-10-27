import express from 'express';
import request from 'supertest';
import * as trpcExpress from '@trpc/server/adapters/express';
import { CATALOG_IMPORT_MAX_BYTES, CATALOG_IMPORT_MAX_ROWS } from '@repo/shared';
import { CATALOG_IMPORT_HTTP_BODY_LIMIT, jsonBodyParser } from '../../bootstrap/json-body';
import { TrpcBase } from '../../trpc/trpc-base';
import type { PrismaService } from '../prisma/prisma.service';
import type { TrpcContext } from '../../trpc/context';
import { AdminRouter } from './admin.router';

function makeRouter() {
  const userFindUnique = jest.fn();
  const seriesFindMany = jest.fn();
  const seriesFindUnique = jest.fn();
  const seriesCreate = jest.fn();
  const seriesUpdate = jest.fn();
  const seriesUpsert = jest.fn();
  const seriesDelete = jest.fn();
  const cardFindUnique = jest.fn();
  const cardFindMany = jest.fn();
  const cardCreate = jest.fn();
  const cardUpdate = jest.fn();
  const cardUpsert = jest.fn();
  const cardDelete = jest.fn();
  const transaction = jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma));

  const prisma = {
    user: { findUnique: userFindUnique },
    series: {
      findMany: seriesFindMany,
      findUnique: seriesFindUnique,
      create: seriesCreate,
      update: seriesUpdate,
      upsert: seriesUpsert,
      delete: seriesDelete,
    },
    card: {
      findUnique: cardFindUnique,
      findMany: cardFindMany,
      create: cardCreate,
      update: cardUpdate,
      upsert: cardUpsert,
      delete: cardDelete,
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: transaction,
  } as unknown as PrismaService;

  const router = new AdminRouter(new TrpcBase(), prisma);
  const built = router.build();

  function caller(user: TrpcContext['user']) {
    return built.createCaller({
      req: {} as never,
      res: {} as never,
      user,
    });
  }

  return {
    prisma,
    caller,
    userFindUnique,
    seriesFindMany,
    seriesFindUnique,
    seriesCreate,
    seriesUpdate,
    seriesUpsert,
    seriesDelete,
    cardFindUnique,
    cardFindMany,
    cardCreate,
    cardUpdate,
    cardUpsert,
    cardDelete,
    transaction,
  };
}

function adminUser() {
  return { sub: 'u-admin', username: 'admin', role: 'admin', tokenVersion: 0, bannedAt: null };
}

function makeHttpApp(prisma: PrismaService) {
  const app = express();
  const t = new TrpcBase();
  const appRouter = t.router({ admin: new AdminRouter(t, prisma).build() });

  app.use(jsonBodyParser());
  app.use(
    '/trpc',
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext: ({ req, res }) => ({ req, res, user: adminUser() }),
    }),
  );
  app.use(
    (
      error: { status?: number; statusCode?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = error.status ?? error.statusCode ?? 500;
      res
        .status(status)
        .type('text/plain')
        .send(error.message ?? 'error');
    },
  );

  return app;
}

describe('AdminRouter auth', () => {
  type RouterHarness = ReturnType<typeof makeRouter>;
  type AdminCaller = ReturnType<RouterHarness['caller']>;
  const writeMockNames = [
    'seriesCreate',
    'seriesUpdate',
    'seriesUpsert',
    'seriesDelete',
    'cardCreate',
    'cardUpdate',
    'cardUpsert',
    'cardDelete',
    'transaction',
  ] as const;

  function expectNoWrites(router: RouterHarness) {
    for (const mockName of writeMockNames) {
      expect(router[mockName]).not.toHaveBeenCalled();
    }
  }

  it.each([
    ['series.list', (admin: AdminCaller) => admin.series.list()],
    [
      'series.create',
      (admin: AdminCaller) => admin.series.create({ slug: 'new-series', title: 'New Series' }),
    ],
    [
      'series.update',
      (admin: AdminCaller) =>
        admin.series.update({ slug: 'existing-series', title: 'Existing Series' }),
    ],
    [
      'series.delete',
      (admin: AdminCaller) => admin.series.delete({ slug: 'existing-series', force: false }),
    ],
    ['cards.get', (admin: AdminCaller) => admin.cards.get({ slug: 'existing-card' })],
    [
      'cards.create',
      (admin: AdminCaller) =>
        admin.cards.create({
          slug: 'new-card',
          name: 'New Card',
          rarity: 'common',
          attributes: {},
          seriesSlug: 'existing-series',
        }),
    ],
    [
      'cards.update',
      (admin: AdminCaller) =>
        admin.cards.update({
          slug: 'existing-card',
          name: 'Existing Card',
          rarity: 'rare',
          attributes: {},
          seriesSlug: 'existing-series',
        }),
    ],
    ['cards.delete', (admin: AdminCaller) => admin.cards.delete({ slug: 'existing-card' })],
    ['catalog.import', (admin: AdminCaller) => admin.catalog.import({ dryRun: false, data: [] })],
  ] as const)('rejects non-admin callers for %s with FORBIDDEN', async (_name, invoke) => {
    const router = makeRouter();

    await expect(
      invoke(
        router.caller({
          sub: 'u1',
          username: 'alice',
          role: 'user',
          tokenVersion: 0,
          bannedAt: null,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(router.userFindUnique).not.toHaveBeenCalled();
    expectNoWrites(router);
  });

  it('rejects anonymous callers with UNAUTHORIZED before checking role', async () => {
    const router = makeRouter();

    await expect(router.caller(null).series.list()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(router.userFindUnique).not.toHaveBeenCalled();
    expectNoWrites(router);
  });
});

describe('AdminRouter.series.list', () => {
  it('returns all series with cardCount and summed commentCount from included counts', async () => {
    const { caller, userFindUnique, seriesFindMany } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindMany.mockResolvedValueOnce([
      {
        id: 's1',
        slug: 'celestial-dawn',
        title: '天穹黎明',
        description: 'desc',
        coverUrl: 'gradient:cover',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-02T00:00:00Z'),
        _count: { cards: 2, comments: 0 },
        cards: [{ _count: { comments: 2 } }, { _count: { comments: 3 } }],
      },
    ]);

    const result = await caller(adminUser()).series.list();

    expect(seriesFindMany).toHaveBeenCalledWith({
      orderBy: [{ title: 'asc' }, { slug: 'asc' }],
      include: {
        _count: { select: { cards: true, comments: true } },
        cards: { select: { _count: { select: { comments: true } } } },
      },
    });
    expect(result.items[0]).toMatchObject({
      slug: 'celestial-dawn',
      cardCount: 2,
      commentCount: 5,
      updatedAt: '2026-05-02T00:00:00.000Z',
    });
  });
});

describe('AdminRouter.cards.get', () => {
  it('returns raw imageUrl, attributes, updatedAt, and commentCount for admins', async () => {
    const { caller, userFindUnique, cardFindUnique } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    cardFindUnique.mockResolvedValueOnce({
      id: 'c1',
      slug: 'aurora-knight',
      name: '极光骑士',
      description: 'desc',
      imageUrl: 'gradient:from-sky-200',
      rarity: 'legendary',
      attributes: { cost: 8, type: '随从' },
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-02T00:00:00Z'),
      series: { slug: 'celestial-dawn', title: '天穹黎明' },
      _count: { comments: 4 },
    });

    const result = await caller(adminUser()).cards.get({ slug: 'aurora-knight' });

    expect(result).toMatchObject({
      slug: 'aurora-knight',
      imageUrl: 'gradient:from-sky-200',
      attributes: { cost: 8, type: '随从' },
      commentCount: 4,
      updatedAt: '2026-05-02T00:00:00.000Z',
    });
  });

  it('returns NOT_FOUND when the card is missing', async () => {
    const { caller, userFindUnique, cardFindUnique } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    cardFindUnique.mockResolvedValueOnce(null);

    await expect(caller(adminUser()).cards.get({ slug: 'missing-card' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '卡牌不存在',
    });
  });
});

describe('AdminRouter.series.create/update', () => {
  it('creates a series and returns normalized counts', async () => {
    const { caller, userFindUnique, seriesCreate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesCreate.mockResolvedValueOnce({
      id: 's1',
      slug: 'new-series',
      title: 'New Series',
      description: null,
      coverUrl: null,
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
      _count: { cards: 0, comments: 0 },
      cards: [],
    });

    await expect(
      caller(adminUser()).series.create({
        slug: 'new-series',
        title: 'New Series',
        description: '',
        coverUrl: '',
      }),
    ).resolves.toMatchObject({
      slug: 'new-series',
      cardCount: 0,
      commentCount: 0,
    });
    expect(seriesCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      slug: 'new-series',
      description: null,
      coverUrl: null,
    });
  });

  it('maps duplicate series slug to SLUG_TAKEN', async () => {
    const { caller, userFindUnique, seriesCreate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesCreate.mockRejectedValueOnce({ code: 'P2002' });

    await expect(
      caller(adminUser()).series.create({ slug: 'dupe-series', title: 'Dupe' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'SLUG_TAKEN',
      cause: { code: 'SLUG_TAKEN' },
    });
  });

  it('updates a series by immutable slug', async () => {
    const { caller, userFindUnique, seriesUpdate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesUpdate.mockResolvedValueOnce({
      id: 's1',
      slug: 'existing-series',
      title: 'Existing Updated',
      description: 'desc',
      coverUrl: 'https://example.test/cover.png',
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-02T00:00:00Z'),
      _count: { cards: 1, comments: 0 },
      cards: [{ _count: { comments: 2 } }],
    });

    await expect(
      caller(adminUser()).series.update({
        slug: 'existing-series',
        title: 'Existing Updated',
        description: 'desc',
        coverUrl: 'https://example.test/cover.png',
      }),
    ).resolves.toMatchObject({
      slug: 'existing-series',
      title: 'Existing Updated',
      cardCount: 1,
      commentCount: 2,
    });
  });

  it('maps missing series update to NOT_FOUND', async () => {
    const { caller, userFindUnique, seriesUpdate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesUpdate.mockRejectedValueOnce({ code: 'P2025' });

    await expect(
      caller(adminUser()).series.update({ slug: 'missing-series', title: 'Missing' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '系列不存在',
    });
  });
});

describe('AdminRouter.cards.create/update/delete', () => {
  it('creates a card under an existing series', async () => {
    const { caller, userFindUnique, seriesFindUnique, cardCreate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindUnique.mockResolvedValueOnce({ id: 's1' });
    cardCreate.mockResolvedValueOnce({
      id: 'c1',
      slug: 'new-card',
      name: 'New Card',
      description: null,
      imageUrl: null,
      rarity: 'common',
      attributes: { cost: 1 },
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
      series: { slug: 'existing-series', title: 'Existing Series' },
      _count: { comments: 0 },
    });

    await expect(
      caller(adminUser()).cards.create({
        slug: 'new-card',
        name: 'New Card',
        rarity: 'common',
        imageUrl: '',
        attributes: { cost: 1 },
        seriesSlug: 'existing-series',
      }),
    ).resolves.toMatchObject({
      slug: 'new-card',
      imageUrl: null,
      commentCount: 0,
      seriesSlug: 'existing-series',
    });
  });

  it('rejects attribute keys, values, and counts over the cap', async () => {
    const { caller, userFindUnique, cardCreate } = makeRouter();
    userFindUnique.mockResolvedValue({ id: 'u-admin', role: 'admin' });
    const base = {
      slug: 'new-card',
      name: 'New Card',
      rarity: 'common' as const,
      seriesSlug: 'existing-series',
    };

    await expect(
      caller(adminUser()).cards.create({
        ...base,
        attributes: { ['k'.repeat(65)]: 'ok' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      caller(adminUser()).cards.create({
        ...base,
        attributes: { lore: 'v'.repeat(501) },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      caller(adminUser()).cards.create({
        ...base,
        attributes: Object.fromEntries(Array.from({ length: 41 }, (_, index) => [`k${index}`, 1])),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(cardCreate).not.toHaveBeenCalled();
  });

  it('maps duplicate card slug to SLUG_TAKEN', async () => {
    const { caller, userFindUnique, seriesFindUnique, cardCreate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindUnique.mockResolvedValueOnce({ id: 's1' });
    cardCreate.mockRejectedValueOnce({ code: 'P2002' });

    await expect(
      caller(adminUser()).cards.create({
        slug: 'dupe-card',
        name: 'Dupe Card',
        rarity: 'rare',
        attributes: {},
        seriesSlug: 'existing-series',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'SLUG_TAKEN',
      cause: { code: 'SLUG_TAKEN' },
    });
  });

  it('rejects card create when the target series does not exist', async () => {
    const { caller, userFindUnique, seriesFindUnique, cardCreate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller(adminUser()).cards.create({
        slug: 'new-card',
        name: 'New Card',
        rarity: 'common',
        attributes: {},
        seriesSlug: 'missing-series',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'SERIES_NOT_FOUND',
      cause: { code: 'SERIES_NOT_FOUND' },
    });
    expect(cardCreate).not.toHaveBeenCalled();
  });

  it('updates a card and can move it to another series', async () => {
    const { caller, userFindUnique, seriesFindUnique, cardUpdate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindUnique.mockResolvedValueOnce({ id: 's2' });
    cardUpdate.mockResolvedValueOnce({
      id: 'c1',
      slug: 'existing-card',
      name: 'Existing Card Updated',
      description: 'desc',
      imageUrl: 'gradient:updated',
      rarity: 'epic',
      attributes: { cost: 4, type: '随从' },
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-02T00:00:00Z'),
      series: { slug: 'target-series', title: 'Target Series' },
      _count: { comments: 3 },
    });

    await expect(
      caller(adminUser()).cards.update({
        slug: 'existing-card',
        name: 'Existing Card Updated',
        description: 'desc',
        rarity: 'epic',
        imageUrl: 'gradient:updated',
        attributes: { cost: 4, type: '随从' },
        seriesSlug: 'target-series',
      }),
    ).resolves.toMatchObject({
      slug: 'existing-card',
      rarity: 'epic',
      seriesSlug: 'target-series',
      commentCount: 3,
    });
  });

  it('maps missing card update to NOT_FOUND', async () => {
    const { caller, userFindUnique, seriesFindUnique, cardUpdate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindUnique.mockResolvedValueOnce({ id: 's1' });
    cardUpdate.mockRejectedValueOnce({ code: 'P2025' });

    await expect(
      caller(adminUser()).cards.update({
        slug: 'missing-card',
        name: 'Missing Card',
        rarity: 'common',
        attributes: {},
        seriesSlug: 'existing-series',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '卡牌不存在',
    });
  });

  it('deletes a card and returns deleted comment count', async () => {
    const { caller, userFindUnique, cardFindUnique, cardDelete } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    cardFindUnique.mockResolvedValueOnce({
      slug: 'existing-card',
      _count: { comments: 2 },
    });
    cardDelete.mockResolvedValueOnce({});

    await expect(caller(adminUser()).cards.delete({ slug: 'existing-card' })).resolves.toEqual({
      ok: true,
      slug: 'existing-card',
      commentCount: 2,
    });
  });

  it('returns NOT_FOUND when deleting a missing card', async () => {
    const { caller, userFindUnique, cardFindUnique, cardDelete } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    cardFindUnique.mockResolvedValueOnce(null);

    await expect(caller(adminUser()).cards.delete({ slug: 'missing-card' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '卡牌不存在',
    });
    expect(cardDelete).not.toHaveBeenCalled();
  });
});

describe('AdminRouter.catalog.import dryRun', () => {
  it('returns per-row created, updated, unchanged, and error statuses with stable codes', async () => {
    const { caller, userFindUnique, seriesFindMany, cardFindMany } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindMany
      .mockResolvedValueOnce([
        {
          slug: 'existing-series',
          title: 'Existing',
          description: 'old',
          coverUrl: null,
        },
      ])
      .mockResolvedValueOnce([{ slug: 'existing-series' }]);
    cardFindMany.mockResolvedValueOnce([
      {
        slug: 'same-card',
        name: 'Same Card',
        description: null,
        rarity: 'common',
        imageUrl: 'gradient:same',
        attributes: { cost: 1 },
        series: { slug: 'existing-series' },
      },
    ]);

    const result = await caller(adminUser()).catalog.import({
      dryRun: true,
      data: [
        {
          slug: 'existing-series',
          title: 'Existing Changed',
          description: 'old',
          coverUrl: '',
          cards: [
            {
              slug: 'same-card',
              name: 'Same Card',
              description: '',
              rarity: 'common',
              imageUrl: 'gradient:same',
              attributes: { cost: 1 },
            },
            {
              slug: 'bad-card',
              name: 'Bad Card',
              rarity: 'mythic',
              imageUrl: 'http://example.test/bad.png',
              attributes: {},
            },
          ],
        },
        {
          slug: 'new-series',
          title: 'New Series',
          coverUrl: 'https://example.test/cover.png',
          cards: [],
        },
      ],
    });

    expect(result.map((row) => row.status)).toEqual(['updated', 'unchanged', 'error', 'created']);
    expect(result[2]?.errors).toEqual([
      { path: 'series[0].cards[1].rarity', code: 'INVALID_RARITY' },
      { path: 'series[0].cards[1].imageUrl', code: 'IMAGE_URL' },
    ]);
    expect(result[1]?.row).toMatchObject({
      type: 'card',
      slug: 'same-card',
      name: 'Same Card',
      seriesSlug: 'existing-series',
    });
  });
});

function importSeries(cardCount: number) {
  return [
    {
      slug: 'imported-series',
      title: 'Imported Series',
      cards: Array.from({ length: cardCount }, (_, index) => ({
        slug: `imported-card-${index}`,
        name: `Imported Card ${index}`,
        rarity: 'common' as const,
        imageUrl: 'gradient:imported',
        attributes: { cost: index },
      })),
    },
  ];
}

describe('AdminRouter.catalog.import limits', () => {
  it('rejects 501 rows in one batch and writes nothing', async () => {
    const {
      caller,
      userFindUnique,
      seriesFindMany,
      cardFindMany,
      seriesUpsert,
      cardUpsert,
      transaction,
    } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });

    await expect(
      caller(adminUser()).catalog.import({
        dryRun: false,
        data: importSeries(CATALOG_IMPORT_MAX_ROWS),
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: `一次最多导入 ${CATALOG_IMPORT_MAX_ROWS} 行，当前 ${CATALOG_IMPORT_MAX_ROWS + 1} 行`,
    });

    expect(seriesFindMany).not.toHaveBeenCalled();
    expect(cardFindMany).not.toHaveBeenCalled();
    expect(seriesUpsert).not.toHaveBeenCalled();
    expect(cardUpsert).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a serialized body over 1MB and writes nothing', async () => {
    const {
      caller,
      userFindUnique,
      seriesFindMany,
      cardFindMany,
      seriesUpsert,
      cardUpsert,
      transaction,
    } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    const input = {
      dryRun: false,
      data: [
        {
          slug: 'oversized-series',
          title: 'Oversized',
          blob: 'x'.repeat(CATALOG_IMPORT_MAX_BYTES),
        },
      ],
    };

    await expect(caller(adminUser()).catalog.import(input)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: '一次最多导入 1MB',
    });

    expect(seriesFindMany).not.toHaveBeenCalled();
    expect(cardFindMany).not.toHaveBeenCalled();
    expect(seriesUpsert).not.toHaveBeenCalled();
    expect(cardUpsert).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('still accepts exactly 500 rows', async () => {
    const { caller, userFindUnique, seriesFindMany, cardFindMany, transaction } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindMany.mockResolvedValue([]);
    cardFindMany.mockResolvedValue([]);

    const result = await caller(adminUser()).catalog.import({
      dryRun: true,
      data: importSeries(CATALOG_IMPORT_MAX_ROWS - 1),
    });

    expect(result).toHaveLength(CATALOG_IMPORT_MAX_ROWS);
    expect(result.every((row) => row.status === 'created')).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('AdminRouter.catalog.import execute', () => {
  it('runs writes inside one transaction so mid-batch failures roll back at the database layer', async () => {
    const {
      caller,
      userFindUnique,
      seriesFindMany,
      cardFindMany,
      seriesUpsert,
      cardUpsert,
      transaction,
    } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    cardFindMany.mockResolvedValueOnce([]);
    seriesUpsert.mockResolvedValueOnce({ id: 's1', slug: 'new-series' });
    cardUpsert.mockRejectedValueOnce(new Error('database write failed'));

    await expect(
      caller(adminUser()).catalog.import({
        dryRun: false,
        data: [
          {
            slug: 'new-series',
            title: 'New Series',
            cards: [
              {
                slug: 'new-card',
                name: 'New Card',
                rarity: 'common',
                imageUrl: 'gradient:new',
                attributes: {},
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow('database write failed');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(seriesUpsert).toHaveBeenCalledTimes(1);
    expect(cardUpsert).toHaveBeenCalledTimes(1);
  });
});

describe('AdminRouter.series.delete', () => {
  it('returns NOT_FOUND when deleting a missing series', async () => {
    const { caller, userFindUnique, seriesFindUnique, seriesDelete } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller(adminUser()).series.delete({ slug: 'missing-series', force: false }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '系列不存在',
    });
    expect(seriesDelete).not.toHaveBeenCalled();
  });

  it('rejects non-forced deletion for series with cards and includes exact counts', async () => {
    const { caller, userFindUnique, seriesFindUnique, seriesDelete } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindUnique.mockResolvedValueOnce({
      slug: 'celestial-dawn',
      _count: { cards: 2, comments: 0 },
      cards: [{ _count: { comments: 2 } }, { _count: { comments: 3 } }],
    });

    await expect(
      caller(adminUser()).series.delete({ slug: 'celestial-dawn', force: false }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'SERIES_HAS_CARDS',
      cause: { code: 'SERIES_HAS_CARDS', cardCount: 2, commentCount: 5 },
    });
    expect(seriesDelete).not.toHaveBeenCalled();
  });

  it('counts series comments when a cardless series is deleted', async () => {
    const withoutForce = makeRouter();
    withoutForce.userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    withoutForce.seriesFindUnique.mockResolvedValueOnce({
      slug: 'empty-series',
      _count: { cards: 0, comments: 3 },
      cards: [],
    });

    await expect(
      withoutForce.caller(adminUser()).series.delete({ slug: 'empty-series', force: false }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'SERIES_HAS_CARDS',
      cause: { code: 'SERIES_HAS_CARDS', cardCount: 0, commentCount: 3 },
    });
    expect(withoutForce.seriesDelete).not.toHaveBeenCalled();

    const withForce = makeRouter();
    withForce.userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    withForce.seriesFindUnique.mockResolvedValueOnce({
      slug: 'empty-series',
      _count: { cards: 0, comments: 3 },
      cards: [],
    });
    withForce.seriesDelete.mockResolvedValueOnce({});

    await expect(
      withForce.caller(adminUser()).series.delete({ slug: 'empty-series', force: true }),
    ).resolves.toEqual({
      ok: true,
      slug: 'empty-series',
      cardCount: 0,
      commentCount: 3,
    });
    expect(withForce.seriesDelete).toHaveBeenCalledWith({ where: { slug: 'empty-series' } });
  });

  it('force deletes series and returns deleted card/comment counts', async () => {
    const { caller, userFindUnique, seriesFindUnique, seriesDelete } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindUnique.mockResolvedValueOnce({
      slug: 'celestial-dawn',
      _count: { cards: 1, comments: 0 },
      cards: [{ _count: { comments: 2 } }],
    });
    seriesDelete.mockResolvedValueOnce({});

    await expect(
      caller(adminUser()).series.delete({ slug: 'celestial-dawn', force: true }),
    ).resolves.toEqual({
      ok: true,
      slug: 'celestial-dawn',
      cardCount: 1,
      commentCount: 2,
    });
  });
});

describe('AdminRouter HTTP error formatting', () => {
  it('exposes SERIES_HAS_CARDS details to HTTP clients without exposing raw cause', async () => {
    const router = makeRouter();
    router.userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    router.seriesFindUnique.mockResolvedValueOnce({
      slug: 'celestial-dawn',
      _count: { cards: 2, comments: 0 },
      cards: [{ _count: { comments: 2 } }, { _count: { comments: 3 } }],
    });

    const response = await request(makeHttpApp(router.prisma))
      .post('/trpc/admin.series.delete')
      .send({ slug: 'celestial-dawn', force: false });

    expect(response.status).toBe(403);
    expect(response.body.error.data.adminCatalogError).toEqual({
      code: 'SERIES_HAS_CARDS',
      cardCount: 2,
      commentCount: 5,
    });
    expect(response.body.error.data.cause).toBeUndefined();
  });

  it('exposes import row errors to HTTP clients', async () => {
    const router = makeRouter();
    router.userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    router.seriesFindMany.mockResolvedValueOnce([]);

    const response = await request(makeHttpApp(router.prisma))
      .post('/trpc/admin.catalog.import')
      .send({
        dryRun: false,
        data: [
          {
            slug: 'new-series',
            title: 'New Series',
            cards: [
              {
                slug: 'bad-card',
                name: 'Bad Card',
                rarity: 'mythic',
                imageUrl: 'http://example.test/bad.png',
                attributes: {},
              },
            ],
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.data.adminCatalogError.rows).toEqual([
      expect.objectContaining({
        row: expect.objectContaining({
          row: 1,
          type: 'series',
          slug: 'new-series',
          name: 'New Series',
        }),
        status: 'created',
        errors: [],
      }),
      expect.objectContaining({
        row: expect.objectContaining({
          row: 2,
          type: 'card',
          slug: 'bad-card',
          name: 'Bad Card',
          seriesSlug: 'new-series',
        }),
        status: 'error',
        errors: [
          { path: 'series[0].cards[0].rarity', code: 'INVALID_RARITY' },
          { path: 'series[0].cards[0].imageUrl', code: 'IMAGE_URL' },
        ],
      }),
    ]);
  });

  it('rejects an HTTP body over the import route cap before any catalog write', async () => {
    const router = makeRouter();
    const body = JSON.stringify({
      dryRun: false,
      data: [
        {
          slug: 'oversized-series',
          title: 'Oversized',
          blob: 'x'.repeat(CATALOG_IMPORT_HTTP_BODY_LIMIT),
        },
      ],
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(CATALOG_IMPORT_HTTP_BODY_LIMIT);

    const response = await request(makeHttpApp(router.prisma))
      .post('/trpc/admin.catalog.import')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(413);
    expect(response.body.error.message).toBe('一次最多导入 1MB');
    expect(response.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
    expect(router.userFindUnique).not.toHaveBeenCalled();
    expect(router.seriesUpsert).not.toHaveBeenCalled();
    expect(router.cardUpsert).not.toHaveBeenCalled();
    expect(router.transaction).not.toHaveBeenCalled();
  });

  it('returns a batched tRPC error when the import HTTP body exceeds the route cap', async () => {
    const router = makeRouter();
    const body = JSON.stringify({
      0: {
        dryRun: false,
        data: [
          {
            slug: 'oversized-series',
            title: 'Oversized',
            blob: 'x'.repeat(CATALOG_IMPORT_HTTP_BODY_LIMIT),
          },
        ],
      },
    });

    const response = await request(makeHttpApp(router.prisma))
      .post('/trpc/admin.catalog.import?batch=1')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(413);
    expect(response.body).toEqual([
      {
        error: {
          message: '一次最多导入 1MB',
          code: -32013,
          data: {
            code: 'PAYLOAD_TOO_LARGE',
            httpStatus: 413,
            path: 'admin.catalog.import',
          },
        },
      },
    ]);
    expect(router.userFindUnique).not.toHaveBeenCalled();
    expect(router.transaction).not.toHaveBeenCalled();
  });

  it('does not reject a just-under-1MB import wrapped in a tRPC batch envelope', async () => {
    const router = makeRouter();
    router.userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    router.seriesFindMany.mockResolvedValue([]);

    const shell = JSON.stringify({
      dryRun: true,
      data: [{ slug: 'wide-series', title: 'Wide', description: '' }],
    });
    const description = 'x'.repeat(CATALOG_IMPORT_MAX_BYTES - 1 - Buffer.byteLength(shell));
    const input = {
      dryRun: true,
      data: [{ slug: 'wide-series', title: 'Wide', description }],
    };
    const body = JSON.stringify({ 0: input });

    expect(Buffer.byteLength(JSON.stringify(input))).toBe(CATALOG_IMPORT_MAX_BYTES - 1);
    expect(Buffer.byteLength(body)).toBeGreaterThan(CATALOG_IMPORT_MAX_BYTES);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(CATALOG_IMPORT_HTTP_BODY_LIMIT);

    const response = await request(makeHttpApp(router.prisma))
      .post('/trpc/admin.catalog.import?batch=1')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).not.toBe(413);
    expect(response.status).toBe(200);
    expect(router.seriesUpsert).not.toHaveBeenCalled();
    expect(router.transaction).not.toHaveBeenCalled();
  });

  it('still parses an import body between the default 100kb cap and 1MB', async () => {
    const router = makeRouter();
    router.userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    router.seriesFindMany.mockResolvedValue([]);
    const description = 'x'.repeat(150_000);
    const body = JSON.stringify({
      dryRun: true,
      data: [{ slug: 'wide-series', title: 'Wide', description }],
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(100 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThan(CATALOG_IMPORT_MAX_BYTES);

    const response = await request(makeHttpApp(router.prisma))
      .post('/trpc/admin.catalog.import')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(router.seriesUpsert).not.toHaveBeenCalled();
    expect(router.transaction).not.toHaveBeenCalled();
  });

  it('returns a tRPC 413 when a non-import route exceeds the default cap', async () => {
    const router = makeRouter();
    const body = JSON.stringify({ blob: 'x'.repeat(150_000) });
    expect(Buffer.byteLength(body)).toBeGreaterThan(100 * 1024);

    const response = await request(makeHttpApp(router.prisma))
      .post('/trpc/admin.series.list')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: {
        message: '内容太大，请精简后重试',
        code: -32013,
        data: {
          code: 'PAYLOAD_TOO_LARGE',
          httpStatus: 413,
          path: 'admin.series.list',
        },
      },
    });
    expect(router.userFindUnique).not.toHaveBeenCalled();
  });
});
