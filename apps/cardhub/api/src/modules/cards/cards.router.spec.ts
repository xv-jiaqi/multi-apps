import { TrpcBase } from '../../trpc/trpc-base';
import { CardsRouter } from './cards.router';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Verifies that cards.search shapes results without leaking the recursive
 * Prisma JsonValue type that previously broke the client (TS2589 — see
 * docs/Cardhub/handoff-context.md §6.7).
 */
function makeRouter() {
  const findMany = jest.fn();
  const findUnique = jest.fn();
  const prisma = {
    card: { findMany, findUnique },
  } as unknown as PrismaService;

  const router = new CardsRouter(new TrpcBase(), prisma);
  const caller = router.build().createCaller({
    req: {} as never,
    res: {} as never,
    user: null,
  });

  return { caller, findMany, findUnique };
}

describe('CardsRouter.search', () => {
  it('uses parsed case-insensitive name filters', async () => {
    const { caller, findMany } = makeRouter();
    findMany.mockResolvedValueOnce([]);

    await caller.search({ q: '极光', limit: 5 });

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({
      AND: [
        {
          OR: [
            {
              AND: [{ name: { contains: '极光', mode: 'insensitive' } }],
            },
          ],
        },
      ],
    });
    expect(args.take).toBe(5);
    expect(args.orderBy).toEqual({ name: 'asc' });
  });

  it('accepts explicit rarity and series filters without changing result shape', async () => {
    const { caller, findMany } = makeRouter();
    findMany.mockResolvedValueOnce([]);

    await caller.search({
      q: '龙',
      limit: 5,
      rarity: 'legendary',
      seriesSlug: 'celestial-dawn',
    });

    expect(findMany.mock.calls[0]?.[0].where).toEqual({
      AND: [
        { rarity: 'legendary' },
        { series: { slug: 'celestial-dawn' } },
        {
          OR: [
            {
              AND: [{ name: { contains: '龙', mode: 'insensitive' } }],
            },
          ],
        },
      ],
    });
  });

  it.each(['r:', 'OR', 's:天穹黎明'])(
    'returns empty results without querying Prisma for no-condition input %s',
    async (q) => {
      const { caller, findMany } = makeRouter();

      await expect(caller.search({ q, limit: 5 })).resolves.toEqual({ query: q, results: [] });

      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it('flattens series relation into seriesSlug / seriesTitle', async () => {
    const { caller, findMany } = makeRouter();
    findMany.mockResolvedValueOnce([
      {
        id: 'c1',
        slug: 'aurora-knight',
        name: '极光骑士',
        rarity: 'legendary',
        imageUrl: 'gradient:from-sky-200',
        series: { slug: 'celestial-dawn', title: '天穹黎明' },
      },
    ]);

    const result = await caller.search({ q: '极', limit: 20 });
    expect(result.results[0]).toEqual({
      id: 'c1',
      slug: 'aurora-knight',
      name: '极光骑士',
      rarity: 'legendary',
      imageUrl: 'gradient:from-sky-200',
      seriesSlug: 'celestial-dawn',
      seriesTitle: '天穹黎明',
    });
  });
});

describe('CardsRouter.bySlug', () => {
  it('returns NOT_FOUND when the card is missing', async () => {
    const { caller, findUnique } = makeRouter();
    findUnique.mockResolvedValueOnce(null);

    await expect(caller.bySlug({ slug: 'no-such-card' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('flattens attributes JSON to a plain dictionary (TS2589 guard)', async () => {
    const { caller, findUnique } = makeRouter();
    findUnique.mockResolvedValueOnce({
      id: 'c1',
      slug: 'aurora-knight',
      name: '极光骑士',
      description: 'desc',
      imageUrl: null,
      rarity: 'legendary',
      attributes: { cost: 8, attack: 9, health: 9, type: '随从' },
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
      series: { slug: 'celestial-dawn', title: '天穹黎明' },
    });

    const result = await caller.bySlug({ slug: 'aurora-knight' });
    expect(result.attributes).toEqual({ cost: 8, attack: 9, health: 9, type: '随从' });
    expect(result.seriesSlug).toBe('celestial-dawn');
    expect(typeof result.createdAt).toBe('string');
  });

  it('returns null attributes when DB stores an array (rejects non-object JSON)', async () => {
    const { caller, findUnique } = makeRouter();
    findUnique.mockResolvedValueOnce({
      id: 'c1',
      slug: 'aurora-knight',
      name: '极光骑士',
      description: null,
      imageUrl: null,
      rarity: null,
      attributes: ['a', 'b'],
      createdAt: new Date(),
      updatedAt: new Date(),
      series: { slug: 'celestial-dawn', title: '天穹黎明' },
    });

    const result = await caller.bySlug({ slug: 'aurora-knight' });
    expect(result.attributes).toBeNull();
  });
});

describe('CardsRouter.listBySeries', () => {
  function makeListRouter() {
    const findUnique = jest.fn();
    const prisma = { series: { findUnique } } as unknown as PrismaService;
    const caller = new CardsRouter(new TrpcBase(), prisma).build().createCaller({
      req: {} as never,
      res: {} as never,
      user: null,
    });
    return { caller, findUnique };
  }

  const rows = [
    {
      id: 'c10',
      slug: 'n-10',
      name: '十',
      rarity: 'common',
      imageUrl: null,
      cardNumber: '10',
      attributes: { attack: 1, lore: 'x', nested: { a: 1 } },
      createdAt: new Date('2020-01-03T00:00:00.000Z'),
      subset: { slug: 'base' },
    },
    {
      id: 'c2',
      slug: 'n-2',
      name: '二',
      rarity: 'rare',
      imageUrl: null,
      cardNumber: '2',
      attributes: null,
      createdAt: new Date('2020-01-02T00:00:00.000Z'),
      subset: null,
    },
    {
      id: 'c1',
      slug: 'n-1',
      name: '一',
      rarity: 'common',
      imageUrl: null,
      cardNumber: '1',
      attributes: ['nope'],
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      subset: { slug: 'base' },
    },
  ];

  it('returns NOT_FOUND when the series is missing', async () => {
    const { caller, findUnique } = makeListRouter();
    findUnique.mockResolvedValueOnce(null);

    await expect(caller.listBySeries({ seriesSlug: 'missing-series' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '系列不存在',
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects an illegal page before querying', async () => {
    const { caller, findUnique } = makeListRouter();

    await expect(caller.listBySeries({ seriesSlug: 'ok-series', page: 0 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('filters in one query, pages after numeric order, and returns labels', async () => {
    const { caller, findUnique } = makeListRouter();
    findUnique.mockResolvedValue({ cards: rows });

    const page = await caller.listBySeries({
      seriesSlug: 'dawn-set',
      q: '十',
      rarity: 'rare',
      subsetSlug: 'base',
      page: 1,
      pageSize: 2,
    });

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique.mock.calls[0]?.[0].where).toEqual({ slug: 'dawn-set' });
    expect(findUnique.mock.calls[0]?.[0].select.cards.where).toEqual({
      rarity: 'rare',
      subset: { slug: 'base' },
    });
    expect(page.total).toBe(1);
    expect(page.pageSize).toBe(2);
    expect(page.sort).toBe('number');
    expect(page.items.map((item) => item.slug)).toEqual(['n-10']);
    expect(page.items[0]).toMatchObject({
      cardNumber: '10',
      attributes: { attack: 1, lore: 'x' },
      subsetSlug: 'base',
    });
    expect(page.attributeLabels.attack).toEqual({ 'zh-CN': '攻击', 'en-US': 'Attack' });
    expect(page.attributeLabels.lore).toEqual({ 'zh-CN': 'lore', 'en-US': 'lore' });
    expect(page.attributeLabels.cost).toEqual({ 'zh-CN': '费用', 'en-US': 'Cost' });
    expect(page.attributeLabels.health).toEqual({ 'zh-CN': '生命', 'en-US': 'Health' });
    expect(page.attributeLabels.type).toEqual({ 'zh-CN': '类型', 'en-US': 'Type' });
    expect(page.attributeLabels).not.toHaveProperty('nested');

    const second = await caller.listBySeries({ seriesSlug: 'dawn-set', page: 2, pageSize: 2 });
    expect(second.items.map((item) => item.slug)).toEqual(['n-10']);
    expect(second.items[0]?.attributes).toEqual({ attack: 1, lore: 'x' });
    expect(second.total).toBe(3);

    const defaults = await caller.listBySeries({ seriesSlug: 'dawn-set' });
    expect(defaults.page).toBe(1);
    expect(defaults.pageSize).toBe(60);
    expect(defaults.sort).toBe('number');
    expect(defaults.items.map((item) => item.cardNumber)).toEqual(['1', '2', '10']);
  });
});
