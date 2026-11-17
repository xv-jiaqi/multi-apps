import { Logger } from '@nestjs/common';
import { TrpcBase } from '../../trpc/trpc-base';
import { CardsRouter } from './cards.router';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Verifies that cards.search shapes results without leaking the recursive
 * Prisma JsonValue type that previously broke the client (TS2589 — see
 * docs/Cardhub/handoff-context.md §6.7).
 */
function makeRouter() {
  const findMany = jest.fn().mockResolvedValue([]);
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
              AND: [
                {
                  OR: [
                    { name: { contains: '极光', mode: 'insensitive' } },
                    { parallelName: { contains: '极光', mode: 'insensitive' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(args.take).toBe(5);
    expect(args.orderBy).toEqual({ name: 'asc' });
  });

  it('escapes LIKE metacharacters in a keyword', async () => {
    const { caller, findMany } = makeRouter();
    findMany.mockResolvedValueOnce([]);

    await caller.search({ q: '100%', limit: 5 });

    expect(findMany.mock.calls[0]?.[0].where).toEqual({
      AND: [
        {
          OR: [
            {
              AND: [
                {
                  OR: [
                    { name: { contains: '100\\%', mode: 'insensitive' } },
                    { parallelName: { contains: '100\\%', mode: 'insensitive' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('keeps null parallel names when an exclude term misses the printed name', async () => {
    const { caller, findMany } = makeRouter();
    findMany.mockResolvedValueOnce([]);

    await caller.search({ q: '-火', limit: 5 });

    expect(findMany.mock.calls[0]?.[0].where).toEqual({
      AND: [
        {
          AND: [
            { NOT: { name: { contains: '火', mode: 'insensitive' } } },
            {
              OR: [
                { parallelName: null },
                { NOT: { parallelName: { contains: '火', mode: 'insensitive' } } },
              ],
            },
          ],
        },
      ],
    });
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
              AND: [
                {
                  OR: [
                    { name: { contains: '龙', mode: 'insensitive' } },
                    { parallelName: { contains: '龙', mode: 'insensitive' } },
                  ],
                },
              ],
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
      parallelName: null,
      printRun: null,
      isParallel: false,
      base: null,
    });
  });
});

describe('CardsRouter.bySlug', () => {
  it('logs a card view with via=adjacent only when the client says so (CH-206 §5)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { caller, findUnique } = makeRouter();
    findUnique.mockResolvedValue(null);
    await expect(caller.bySlug({ slug: 'a', via: 'adjacent' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(log).toHaveBeenCalledWith({ event: 'card.view', slug: 'a', via: 'adjacent' });
    await expect(caller.bySlug({ slug: 'a', via: 'other' as never })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    log.mockRestore();
  });

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
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      series: { findUnique },
      card: { count },
    } as unknown as PrismaService;
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
    findUnique.mockResolvedValue({ cards: rows, _count: { cards: rows.length } });

    const page = await caller.listBySeries({
      seriesSlug: 'dawn-set',
      q: '十',
      rarity: 'common',
      subsetSlug: 'base',
      page: 1,
      pageSize: 2,
    });

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique.mock.calls[0]?.[0].where).toEqual({ slug: 'dawn-set' });
    // CH-239: the whole series is read once so `rarityCodes` does not follow
    // filters; parallels, rarity, subset, and keyword filter in process.
    expect(findUnique.mock.calls[0]?.[0].select.cards.where).toBeUndefined();
    expect(page.total).toBe(1);
    expect(page.seriesTotal).toBe(3);
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
    expect(second.seriesTotal).toBe(3);

    const defaults = await caller.listBySeries({ seriesSlug: 'dawn-set' });
    expect(defaults.page).toBe(1);
    expect(defaults.pageSize).toBe(60);
    expect(defaults.sort).toBe('number');
    expect(defaults.items.map((item) => item.cardNumber)).toEqual(['1', '2', '10']);
  });

  describe('ptcg-sc-30th shape (CH-237 / AC7-4)', () => {
    const SPECIAL = ['R', 'G', 'B'];
    const ENERGY = ['GRA', 'FIR', 'WAT', 'LIG', 'PSY', 'FIG', 'DAR', 'MET'];
    const subsets = {
      main: { slug: 'main', sortOrder: 0 },
      secret: { slug: 'secret', sortOrder: 1 },
      special: { slug: 'special', sortOrder: 2 },
      energy: { slug: 'energy', sortOrder: 3 },
    };
    const listRow = (cardNumber: string, subset: { slug: string; sortOrder: number }) => ({
      id: `id-${cardNumber}`,
      slug: `ptcg-sc-30th-${cardNumber}`,
      name: cardNumber,
      rarity: 'common',
      imageUrl: null,
      cardNumber,
      attributes: {},
      createdAt: new Date('2026-11-17T00:00:00.000Z'),
      parallelOfId: null,
      parallelName: null,
      printRun: null,
      subset,
    });
    const numbered = Array.from({ length: 165 }, (_, index) => {
      const value = index + 1;
      return listRow(String(value).padStart(3, '0'), value <= 103 ? subsets.main : subsets.secret);
    });
    const lettered = [
      ...SPECIAL.map((value) => listRow(value, subsets.special)),
      ...ENERGY.map((value) => listRow(value, subsets.energy)),
    ];
    // Interleave so the input order is neither numeric nor grouped by subset.
    const fixture = [...lettered, ...numbered].reverse();
    const expected = [
      ...numbered.map((row) => row.cardNumber),
      'B',
      'G',
      'R',
      'DAR',
      'FIG',
      'FIR',
      'GRA',
      'LIG',
      'MET',
      'PSY',
      'WAT',
    ];

    it('lists 165 numbers ascending, then special B G R, then the 8 energies', async () => {
      const { caller, findUnique } = makeListRouter();
      findUnique.mockResolvedValue({ cards: fixture, _count: { cards: fixture.length } });

      // pageSize is capped at 100 (CARD_SERIES_LIST input), so AC7-4's 176
      // cards come back as two pages of the same call.
      const first = await caller.listBySeries({
        seriesSlug: 'ptcg-sc-30th',
        sort: 'number',
        pageSize: 100,
      });
      const second = await caller.listBySeries({
        seriesSlug: 'ptcg-sc-30th',
        sort: 'number',
        page: 2,
        pageSize: 100,
      });

      expect(findUnique).toHaveBeenCalledTimes(2);
      expect(findUnique.mock.calls[0]?.[0].select.cards.select.subset).toEqual({
        select: { slug: true, sortOrder: true },
      });
      expect(first.total).toBe(176);
      expect(second.total).toBe(176);
      const items = [...first.items, ...second.items];
      expect(items.map((item) => item.cardNumber)).toEqual(expected);
      expect(items.at(-1)).toMatchObject({ cardNumber: 'WAT', subsetSlug: 'energy' });
    });

    it('sorts the whole series before slicing a page', async () => {
      const { caller, findUnique } = makeListRouter();
      findUnique.mockResolvedValue({ cards: fixture, _count: { cards: fixture.length } });

      const second = await caller.listBySeries({
        seriesSlug: 'ptcg-sc-30th',
        sort: 'number',
        page: 3,
        pageSize: 80,
      });

      expect(second.total).toBe(176);
      expect(second.items.map((item) => item.cardNumber)).toEqual(expected.slice(160));
    });
  });

  describe('official rarity code (CH-239 / AC7-7)', () => {
    const subsets = {
      main: { slug: 'main', sortOrder: 0 },
      special: { slug: 'special', sortOrder: 2 },
    };
    type Row = ReturnType<typeof codeRow>;
    function codeRow(
      cardNumber: string,
      code: unknown,
      extra: Partial<{
        rarity: string;
        subset: { slug: string; sortOrder: number };
        name: string;
        parallelOfId: string | null;
      }> = {},
    ) {
      return {
        id: `id-${cardNumber}${extra.parallelOfId ? '-p' : ''}`,
        slug: `ptcg-sc-30th-${cardNumber}${extra.parallelOfId ? '-p' : ''}`,
        name: extra.name ?? `卡${cardNumber}`,
        rarity: extra.rarity ?? 'common',
        imageUrl: null,
        cardNumber,
        attributes: code === undefined ? {} : { 稀有度: code, 插画师: 'A' },
        createdAt: new Date('2026-11-17T00:00:00.000Z'),
        parallelOfId: extra.parallelOfId ?? null,
        parallelName: extra.parallelOfId ? '闪' : null,
        printRun: null,
        subset: extra.subset ?? subsets.main,
      };
    }
    // Stored out of number order so first appearance must follow sort=number.
    const fixture: Row[] = [
      codeRow('177', 'FUR', { rarity: 'legendary' }),
      codeRow('166', 'SAR', { rarity: 'legendary' }),
      codeRow('003', 'RR', { rarity: 'rare' }),
      codeRow('001', 'C'),
      codeRow('100', '无标记'),
      codeRow('168', ' SAR ', { rarity: 'legendary', name: '皮卡丘' }),
      codeRow('002', 'R', { rarity: 'rare' }),
      codeRow('120', 'AR', { rarity: 'epic' }),
      codeRow('004', 'C'),
      codeRow('R', 'SAR', { rarity: 'legendary', subset: subsets.special }),
      codeRow('050', '   '),
      codeRow('051', 7),
      codeRow('052', undefined),
      codeRow('053', 'TOO-LONG-CODE'),
    ];
    const ALL_CODES = ['C', 'R', 'RR', '无标记', 'AR', 'SAR', 'FUR'];

    function load(cards: Row[] = fixture) {
      const router = makeListRouter();
      router.findUnique.mockResolvedValue({
        cards,
        _count: { cards: cards.filter((card) => card.parallelOfId === null).length },
      });
      return router;
    }

    it('keeps only cards whose trimmed attributes.稀有度 equals rarityCode', async () => {
      const { caller, findUnique } = load();
      const page = await caller.listBySeries({ seriesSlug: 'ptcg-sc-30th', rarityCode: 'SAR' });

      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(page.total).toBe(3);
      expect(page.items.map((item) => item.cardNumber)).toEqual(['166', '168', 'R']);
      expect(page.items.every((item) => item.rarityCode === 'SAR')).toBe(true);
      expect(page.items[1]?.attributes).toEqual({ 稀有度: ' SAR ', 插画师: 'A' });
      expect(page.seriesTotal).toBe(fixture.length);
      expect(page.rarityCodes).toEqual(ALL_CODES);
    });

    it('lists every code in first sort=number appearance, whatever the filters', async () => {
      const { caller } = load();
      for (const input of [
        {},
        { rarityCode: 'C' },
        { rarity: 'epic' as const },
        { subsetSlug: 'special' },
        { q: '皮卡丘' },
        { sort: 'name' as const },
        { sort: 'created' as const, page: 3, pageSize: 1 },
        { includeParallels: true },
      ]) {
        const page = await caller.listBySeries({ seriesSlug: 'ptcg-sc-30th', ...input });
        expect(page.rarityCodes).toEqual(ALL_CODES);
        expect(page.baseRarityCodes).toEqual(ALL_CODES);
      }
    });

    it('sets item rarityCode to the trimmed code or null', async () => {
      const { caller } = load();
      const page = await caller.listBySeries({ seriesSlug: 'ptcg-sc-30th', pageSize: 100 });
      const byNumber = new Map(page.items.map((item) => [item.cardNumber, item.rarityCode]));
      expect(byNumber.get('168')).toBe('SAR');
      expect(byNumber.get('100')).toBe('无标记');
      expect(byNumber.get('050')).toBeNull();
      expect(byNumber.get('051')).toBeNull();
      expect(byNumber.get('052')).toBeNull();
      // Shown on the card, but not offered as a filter it could never pass.
      expect(byNumber.get('053')).toBe('TOO-LONG-CODE');
      expect(page.rarityCodes).not.toContain('TOO-LONG-CODE');
    });

    it('returns an empty page, not an error, for a code the series does not have', async () => {
      const { caller } = load();
      const page = await caller.listBySeries({ seriesSlug: 'ptcg-sc-30th', rarityCode: 'XYZ' });
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.seriesTotal).toBe(fixture.length);
      expect(page.rarityCodes).toEqual(ALL_CODES);
    });

    it('combines rarityCode with rarity, subset, and keyword', async () => {
      const { caller } = load();
      const special = await caller.listBySeries({
        seriesSlug: 'ptcg-sc-30th',
        rarityCode: 'SAR',
        subsetSlug: 'special',
      });
      expect(special.items.map((item) => item.cardNumber)).toEqual(['R']);
      const keyword = await caller.listBySeries({
        seriesSlug: 'ptcg-sc-30th',
        rarityCode: 'SAR',
        q: '皮卡丘',
      });
      expect(keyword.items.map((item) => item.cardNumber)).toEqual(['168']);
      const conflicting = await caller.listBySeries({
        seriesSlug: 'ptcg-sc-30th',
        rarityCode: 'SAR',
        rarity: 'common',
      });
      expect(conflicting.total).toBe(0);
    });

    it('adds baseRarityCodes without parallel-only codes; rarityCodes stays whole (需求 v1.1)', async () => {
      const cards = [
        codeRow('002', 'R', { parallelOfId: 'id-002' }),
        codeRow('001', 'C'),
        codeRow('001', 'S', { parallelOfId: 'id-001' }),
        codeRow('002', 'R'),
        codeRow('000', 'R', { parallelOfId: 'id-000' }),
      ];
      const { caller } = load(cards);
      for (const input of [
        {},
        { includeParallels: true },
        { rarityCode: 'C' },
        { rarityCode: 'S', includeParallels: true },
        { subsetSlug: 'special' },
      ]) {
        const page = await caller.listBySeries({ seriesSlug: 'ptcg-sc-30th', ...input });
        // R first appears on parallel 000, so it leads both lists.
        expect(page.rarityCodes).toEqual(['R', 'C', 'S']);
        expect(page.baseRarityCodes).toEqual(['R', 'C']);
      }
      // Old link: parallel-only code with parallels off is an empty list, not an error.
      const stale = await caller.listBySeries({ seriesSlug: 'ptcg-sc-30th', rarityCode: 'S' });
      expect(stale.total).toBe(0);
      expect(stale.items).toEqual([]);
      const shown = await caller.listBySeries({
        seriesSlug: 'ptcg-sc-30th',
        rarityCode: 'S',
        includeParallels: true,
      });
      expect(shown.items.map((item) => item.slug)).toEqual(['ptcg-sc-30th-001-p']);
      expect(shown.items[0]?.isParallel).toBe(true);
    });

    it('returns an empty rarityCodes for a series without official codes', async () => {
      const { caller } = load([codeRow('1', undefined), codeRow('2', '  ')]);
      const page = await caller.listBySeries({ seriesSlug: 'ptcg-sc-30th' });
      expect(page.rarityCodes).toEqual([]);
      expect(page.baseRarityCodes).toEqual([]);
      expect(page.total).toBe(2);
      expect(page.items.map((item) => item.rarityCode)).toEqual([null, null]);
    });
  });
});
