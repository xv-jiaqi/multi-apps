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
    $transaction: transaction,
  } as unknown as PrismaService;

  const router = new AdminRouter(new TrpcBase(prisma), prisma);
  const built = router.build();

  function caller(user: TrpcContext['user']) {
    return built.createCaller({
      req: {} as never,
      res: {} as never,
      user,
    });
  }

  return {
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
  return { sub: 'u-admin', username: 'admin' };
}

describe('AdminRouter auth', () => {
  it('rejects non-admin callers with FORBIDDEN', async () => {
    const { caller, userFindUnique, seriesFindMany } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u1', role: 'user' });

    await expect(caller({ sub: 'u1', username: 'alice' }).series.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(seriesFindMany).not.toHaveBeenCalled();
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
        _count: { cards: 2 },
        cards: [{ _count: { comments: 2 } }, { _count: { comments: 3 } }],
      },
    ]);

    const result = await caller(adminUser()).series.list();

    expect(seriesFindMany).toHaveBeenCalledWith({
      orderBy: [{ title: 'asc' }, { slug: 'asc' }],
      include: {
        _count: { select: { cards: true } },
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

describe('AdminRouter.catalog.import execute', () => {
  it('runs writes inside one transaction so mid-batch failures roll back at the database layer', async () => {
    const { caller, userFindUnique, seriesFindMany, cardFindMany, seriesUpsert, cardUpsert, transaction } =
      makeRouter();
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
  it('rejects non-forced deletion for series with cards and includes exact counts', async () => {
    const { caller, userFindUnique, seriesFindUnique, seriesDelete } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindUnique.mockResolvedValueOnce({
      slug: 'celestial-dawn',
      _count: { cards: 2 },
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

  it('force deletes series and returns deleted card/comment counts', async () => {
    const { caller, userFindUnique, seriesFindUnique, seriesDelete } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    seriesFindUnique.mockResolvedValueOnce({
      slug: 'celestial-dawn',
      _count: { cards: 1 },
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
