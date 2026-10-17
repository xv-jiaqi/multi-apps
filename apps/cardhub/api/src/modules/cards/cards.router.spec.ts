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
