import { parseCardSearchQuery } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import type { PrismaService } from '../prisma/prisma.service';
import { SearchRouter } from './search.router';

function makeRouter() {
  const cardFindMany = jest.fn();
  const seriesFindMany = jest.fn();
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

  return { caller, cardFindMany, seriesFindMany };
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
});

describe('SearchRouter.global', () => {
  it('uses limit as the fallback for both groups', async () => {
    const { caller, cardFindMany, seriesFindMany } = makeRouter();
    cardFindMany.mockResolvedValueOnce([]);
    seriesFindMany.mockResolvedValueOnce([]);

    await caller.global({ q: '极光', limit: 7 });

    expect(cardFindMany.mock.calls[0]?.[0].take).toBe(7);
    expect(seriesFindMany.mock.calls[0]?.[0].take).toBe(7);
  });

  it('uses independent cardLimit and seriesLimit when provided', async () => {
    const { caller, cardFindMany, seriesFindMany } = makeRouter();
    cardFindMany.mockResolvedValueOnce([]);
    seriesFindMany.mockResolvedValueOnce([]);

    await caller.global({ q: '极光', limit: 10, cardLimit: 5, seriesLimit: 3 });

    expect(cardFindMany.mock.calls[0]?.[0].take).toBe(5);
    expect(seriesFindMany.mock.calls[0]?.[0].take).toBe(3);
  });

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
    const { caller, cardFindMany, seriesFindMany } = makeRouter();
    cardFindMany.mockResolvedValueOnce([]);
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
      _count: { select: { cards: true } },
    });
  });

  it('keeps query count constant as result count grows', async () => {
    const { caller, cardFindMany, seriesFindMany } = makeRouter();
    cardFindMany.mockResolvedValueOnce([]);
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

    expect(cardFindMany).toHaveBeenCalledTimes(1);
    expect(seriesFindMany).toHaveBeenCalledTimes(1);
  });
});
