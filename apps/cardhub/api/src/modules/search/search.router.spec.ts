import { parseCardSearchQuery, shouldRequestCardSearchQuery } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import type { PrismaService } from '../prisma/prisma.service';
import { SearchRouter } from './search.router';

type FakeCard = {
  id: string;
  slug: string;
  name: string;
  rarity: string | null;
  imageUrl: string | null;
  cardNumber: string | null;
  createdAt: Date;
  parallelOfId: string | null;
  parallelName: string | null;
  printRun: number | null;
  subset: { slug: string; name: string; sortOrder: number } | null;
  series: { slug: string; title: string; releaseDate: Date | null };
  parallelOf: { slug: string; name: string } | null;
};

const SERIES_30TH = {
  slug: 'ptcg-sc-30th',
  title: '30周年庆典',
  releaseDate: new Date('2026-09-16'),
};
const SERIES_151 = { slug: 'ptcg-sc-151', title: '收集啦151', releaseDate: new Date('2025-01-17') };

function fakeCard(
  id: string,
  name: string,
  cardNumber: string | null,
  series: FakeCard['series'],
  subset: FakeCard['subset'] = null,
): FakeCard {
  return {
    id,
    slug: id,
    name,
    rarity: 'common',
    imageUrl: null,
    cardNumber,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    parallelOfId: null,
    parallelName: null,
    printRun: null,
    subset,
    series,
    parallelOf: null,
  };
}

function numberedCards(count: number): FakeCard[] {
  return Array.from({ length: count }, (_, index) =>
    fakeCard(
      `c${String(index + 1).padStart(3, '0')}`,
      `极光${index}`,
      String(index + 1),
      SERIES_30TH,
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Ids from `{ where: { id: { in: [...] } } }`, or null for the ranking read. */
function idFilter(args: unknown): string[] | null {
  if (!isRecord(args) || !isRecord(args.where) || !isRecord(args.where.id)) return null;
  const ids = args.where.id.in;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : null;
}

function makeRouter() {
  // The fake ignores the SQL where; `catalog` is the matching set.
  const catalog: FakeCard[] = [];
  const cardFindMany = jest.fn(async (args: unknown) => {
    const ids = idFilter(args);
    if (ids === null) return [...catalog].reverse();
    return catalog.filter((card) => ids.includes(card.id)).reverse();
  });
  const seriesFindMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    card: { findMany: cardFindMany },
    series: { findMany: seriesFindMany },
  } as unknown as PrismaService;

  const router = new SearchRouter(new TrpcBase(), prisma);
  const caller = router.build().createCaller({
    req: {} as never,
    res: {} as never,
    user: null,
  });

  return { caller, cardFindMany, seriesFindMany, catalog };
}

describe('parseCardSearchQuery', () => {
  it('returns unknownPrefix with the original token', () => {
    expect(parseCardSearchQuery('usd<1 龙')).toEqual({
      ok: false,
      reason: 'unknownPrefix',
      token: 'usd<1',
    });
  });

  it('returns invalidRarity with the original token', () => {
    expect(parseCardSearchQuery('r:mythic 龙')).toEqual({
      ok: false,
      reason: 'invalidRarity',
      token: 'r:mythic',
    });
  });

  it('treats incomplete r: and s: prefixes as absent filters', () => {
    expect(parseCardSearchQuery('r: s: 龙')).toEqual({
      ok: true,
      includeGroups: [['龙']],
      excludeTerms: [],
    });
  });

  it('parses rarity, series, OR groups, and exclusions', () => {
    expect(parseCardSearchQuery('r:legendary s:celestial-dawn 龙 OR 凤 -幼体')).toEqual({
      ok: true,
      rarity: 'legendary',
      seriesSlug: 'celestial-dawn',
      includeGroups: [['龙'], ['凤']],
      excludeTerms: ['幼体'],
    });
  });

  it.each(['r:', 'OR', 's:天穹黎明'])('marks %s as a client-side no-request query', (q) => {
    expect(shouldRequestCardSearchQuery(q)).toBe(false);
  });

  it('allows valid client-side search requests', () => {
    expect(shouldRequestCardSearchQuery('极光')).toBe(true);
    expect(shouldRequestCardSearchQuery('r:legendary')).toBe(true);
    expect(shouldRequestCardSearchQuery('s:celestial-dawn')).toBe(true);
  });
});

describe('SearchRouter.global', () => {
  it('uses limit as the fallback for both groups', async () => {
    const { caller, seriesFindMany, catalog } = makeRouter();
    catalog.push(...numberedCards(9));
    seriesFindMany.mockResolvedValueOnce([]);

    const result = await caller.global({ q: '极光', limit: 7 });

    expect(result.cards).toHaveLength(7);
    expect(seriesFindMany.mock.calls[0]?.[0].take).toBe(7);
  });

  it('uses independent cardLimit and seriesLimit when provided', async () => {
    const { caller, seriesFindMany, catalog } = makeRouter();
    catalog.push(...numberedCards(9));
    seriesFindMany.mockResolvedValueOnce([]);

    const result = await caller.global({ q: '极光', limit: 10, cardLimit: 5, seriesLimit: 3 });

    expect(result.cards).toHaveLength(5);
    expect(seriesFindMany.mock.calls[0]?.[0].take).toBe(3);
  });

  it.each(['r:legendary', '-幼体'])(
    'does not query series when input has no series or positive name condition: %s',
    async (q) => {
      const { caller, cardFindMany, seriesFindMany } = makeRouter();

      await expect(caller.global({ q, limit: 5 })).resolves.toEqual({
        query: q,
        cards: [],
        cardTotal: 0,
        cardPage: 1,
        series: [],
      });

      expect(cardFindMany).toHaveBeenCalledTimes(1);
      expect(seriesFindMany).not.toHaveBeenCalled();
    },
  );

  it.each(['r:', 'OR', 's:天穹黎明'])(
    'returns empty results without querying Prisma for no-condition input %s',
    async (q) => {
      const { caller, cardFindMany, seriesFindMany } = makeRouter();

      await expect(caller.global({ q })).resolves.toEqual({
        query: q,
        cards: [],
        cardTotal: 0,
        cardPage: 1,
        series: [],
      });

      expect(cardFindMany).not.toHaveBeenCalled();
      expect(seriesFindMany).not.toHaveBeenCalled();
    },
  );

  it('rejects new group limits above their caps', async () => {
    const { caller } = makeRouter();

    await expect(caller.global({ q: '极光', cardLimit: 51 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller.global({ q: '极光', seriesLimit: 21 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('returns series cardCount and coverUrl from the same series query', async () => {
    const { caller, seriesFindMany } = makeRouter();
    seriesFindMany.mockResolvedValueOnce([
      {
        id: 's1',
        slug: 'celestial-dawn',
        title: '天穹黎明',
        description: 'desc',
        coverUrl: 'https://example.com/cover.jpg',
        _count: { cards: 9 },
      },
    ]);

    const result = await caller.global({ q: '天穹', limit: 5 });

    expect(result.series[0]).toEqual({
      id: 's1',
      slug: 'celestial-dawn',
      title: '天穹黎明',
      description: 'desc',
      coverUrl: 'https://example.com/cover.jpg',
      cardCount: 9,
    });
    expect(seriesFindMany).toHaveBeenCalledTimes(1);
    expect(seriesFindMany.mock.calls[0]?.[0].include).toEqual({
      _count: { select: { cards: { where: { parallelOfId: null } } } },
    });
  });

  it('keeps query count constant as result count grows', async () => {
    const { caller, cardFindMany, seriesFindMany, catalog } = makeRouter();
    catalog.push(...numberedCards(40));
    seriesFindMany.mockResolvedValueOnce(
      Array.from({ length: 3 }, (_, index) => ({
        id: `s${index}`,
        slug: `series-${index}`,
        title: `系列 ${index}`,
        description: null,
        coverUrl: null,
        _count: { cards: index },
      })),
    );

    await caller.global({ q: '系列', limit: 3 });

    // One ranking read of the matches, one read of the page rows.
    expect(cardFindMany).toHaveBeenCalledTimes(2);
    expect(seriesFindMany).toHaveBeenCalledTimes(1);
  });
});

describe('SearchRouter.global CH-241 paging, relevance, and card fields', () => {
  function pikachuCatalog(): FakeCard[] {
    const main = { slug: 'main', name: '收录卡', sortOrder: 0 };
    const secret = { slug: 'secret', name: '编号外', sortOrder: 1 };
    return [
      fakeCard('151-170', '皮卡丘', '170', SERIES_151, secret),
      fakeCard('30th-047', '皮卡丘ex', '047', SERIES_30TH),
      fakeCard('151-025', '皮卡丘', '025', SERIES_151, main),
      fakeCard('30th-017', '皮卡丘', '017', SERIES_30TH),
      fakeCard('30th-136', '皮卡丘', '136', SERIES_30TH),
      fakeCard('x-001', '雷丘与皮卡丘', '001', SERIES_30TH),
    ];
  }

  it('returns cardTotal and cardPage, and pages concatenate to the whole set without repeats', async () => {
    const { caller, catalog } = makeRouter();
    catalog.push(...pikachuCatalog());

    const pages = [];
    for (const cardPage of [1, 2, 3]) {
      pages.push(await caller.global({ q: '皮卡丘', cardLimit: 2, cardPage }));
    }

    expect(pages.map((page) => page.cardTotal)).toEqual([6, 6, 6]);
    expect(pages.map((page) => page.cardPage)).toEqual([1, 2, 3]);
    const ids = pages.flatMap((page) => page.cards.map((card) => card.id));
    expect(ids).toEqual(['30th-017', '30th-136', '151-025', '151-170', '30th-047', 'x-001']);
    expect(new Set(ids).size).toBe(6);
  });

  it('returns an empty page past the end with the same cardTotal', async () => {
    const { caller, catalog, cardFindMany } = makeRouter();
    catalog.push(...pikachuCatalog());

    const result = await caller.global({ q: '皮卡丘', cardLimit: 5, cardPage: 9 });

    expect(result).toMatchObject({ cards: [], cardTotal: 6, cardPage: 9 });
    expect(cardFindMany).toHaveBeenCalledTimes(1);
  });

  it('defaults cardPage to 1 when omitted (header search)', async () => {
    const { caller, catalog } = makeRouter();
    catalog.push(...pikachuCatalog());

    const result = await caller.global({ q: '皮卡丘', cardLimit: 5, seriesLimit: 3 });

    expect(result.cardPage).toBe(1);
    expect(result.cards.map((card) => card.id)).toEqual([
      '30th-017',
      '30th-136',
      '151-025',
      '151-170',
      '30th-047',
    ]);
  });

  it('adds cardNumber, subsetSlug, and subsetName to each card, null when absent', async () => {
    const { caller, catalog } = makeRouter();
    catalog.push(...pikachuCatalog(), fakeCard('blank', '皮卡丘V', null, SERIES_151));

    const result = await caller.global({ q: '皮卡丘', cardLimit: 50 });
    const byId = new Map(result.cards.map((card) => [card.id, card]));

    expect(byId.get('151-025')).toMatchObject({
      cardNumber: '025',
      subsetSlug: 'main',
      subsetName: '收录卡',
    });
    expect(byId.get('30th-017')).toMatchObject({
      cardNumber: '017',
      subsetSlug: null,
      subsetName: null,
    });
    expect(byId.get('blank')).toMatchObject({ cardNumber: null });
  });

  it('reads the page rows by id only, after ranking with a narrow select', async () => {
    const { caller, catalog, cardFindMany } = makeRouter();
    catalog.push(...pikachuCatalog());

    await caller.global({ q: '皮卡丘', cardLimit: 2, cardPage: 2 });

    const [rankArgs] = cardFindMany.mock.calls[0] ?? [];
    expect(isRecord(rankArgs) && isRecord(rankArgs.select)).toBe(true);
    expect(isRecord(rankArgs) && 'take' in rankArgs).toBe(false);
    expect(idFilter(cardFindMany.mock.calls[1]?.[0])).toEqual(['151-025', '151-170']);
  });

  it.each([0, -1, 1.5])('rejects cardPage %s as BAD_REQUEST', async (cardPage) => {
    const { caller } = makeRouter();
    await expect(caller.global({ q: '皮卡丘', cardPage })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('rejects cardPage above its cap', async () => {
    const { caller } = makeRouter();
    await expect(caller.global({ q: '皮卡丘', cardPage: 10_001 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('ORs a bare numeric word with the exact card number key in the SQL filter', async () => {
    const { caller, cardFindMany } = makeRouter();

    await caller.global({ q: '025 s:ptcg-sc-151' });

    const where = JSON.stringify(cardFindMany.mock.calls[0]?.[0]);
    expect(where).toContain('"cardNumberNormalized":"25"');
    expect(where).toContain('"contains":"025"');
    expect(where).toContain('"slug":"ptcg-sc-151"');
  });
});
