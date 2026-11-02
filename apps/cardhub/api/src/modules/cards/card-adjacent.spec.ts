import type { PrismaService } from '../prisma/prisma.service';
import { loadCardAdjacent } from './card-adjacent';

type Row = { id: string; slug: string; name: string; cardNumber: string | null };

function row(id: string, cardNumber: string | null): Row & Record<string, unknown> {
  return {
    id,
    slug: `s-${id}`,
    name: `n-${id}`,
    imageUrl: null,
    cardNumber,
    rarity: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function prismaWith(card: unknown, scope: unknown[]) {
  const findUnique = jest.fn().mockResolvedValue(card);
  const findMany = jest.fn().mockResolvedValue(scope);
  return {
    prisma: { card: { findUnique, findMany } } as unknown as PrismaService,
    findMany,
  };
}

describe('loadCardAdjacent (CH-206 §11-3)', () => {
  it('orders by card number, breaks ties on id, and scopes to the subset base cards', async () => {
    const { prisma, findMany } = prismaWith(
      { id: 'b', seriesId: 'S', subsetId: 'U', parallelOf: null },
      [row('c', '010'), row('b', '002'), row('a', '002'), row('d', '001')],
    );
    const result = await loadCardAdjacent(prisma, 's-b');
    expect(findMany.mock.calls[0][0].where).toEqual({
      seriesId: 'S',
      subsetId: 'U',
      parallelOfId: null,
    });
    // order: d(001) a(002) b(002) c(010)
    expect(result).toEqual({
      prev: { slug: 's-a', name: 'n-a', imageUrl: null },
      next: { slug: 's-c', name: 'n-c', imageUrl: null },
    });
  });

  it('uses the series cards without a subset when the card has none', async () => {
    const { prisma, findMany } = prismaWith(
      { id: 'a', seriesId: 'S', subsetId: null, parallelOf: null },
      [row('a', '001'), row('b', '002')],
    );
    const result = await loadCardAdjacent(prisma, 's-a');
    expect(findMany.mock.calls[0][0].where.subsetId).toBeNull();
    expect(result.prev).toBeNull();
    expect(result.next?.slug).toBe('s-b');
  });

  it('gives a parallel the neighbours of its base card', async () => {
    const { prisma, findMany } = prismaWith(
      {
        id: 'p',
        seriesId: 'S',
        subsetId: 'U',
        parallelOf: { id: 'b', seriesId: 'S', subsetId: 'U' },
      },
      [row('a', '001'), row('b', '002'), row('c', '003')],
    );
    const result = await loadCardAdjacent(prisma, 's-p');
    expect(findMany.mock.calls[0][0].where.parallelOfId).toBeNull();
    expect(result.prev?.slug).toBe('s-a');
    expect(result.next?.slug).toBe('s-c');
  });

  it('returns no neighbours for a missing card or a lone card', async () => {
    expect(await loadCardAdjacent(prismaWith(null, []).prisma, 'x')).toEqual({
      prev: null,
      next: null,
    });
    const lone = prismaWith({ id: 'a', seriesId: 'S', subsetId: null, parallelOf: null }, [
      row('a', null),
    ]);
    expect(await loadCardAdjacent(lone.prisma, 's-a')).toEqual({ prev: null, next: null });
  });
});
