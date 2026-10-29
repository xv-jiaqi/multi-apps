import { TrpcBase } from '../../trpc/trpc-base';
import type { PrismaService } from '../prisma/prisma.service';
import { SeriesRouter } from './series.router';

function timeRow(id: string) {
  return {
    id,
    createdNonFinite: false,
    updatedNonFinite: false,
    createdYear: 2026,
    updatedYear: 2026,
    createdRest: '05-01T00:00:00.000',
    updatedRest: '05-02T00:00:00.000',
  };
}

function makeRouter() {
  const findMany = jest.fn();
  const count = jest.fn();
  const findUnique = jest.fn();
  const queryRaw = jest.fn((query: TemplateStringsArray) => {
    const text = Array.isArray(query) ? query.join(' ') : '';
    if (text.includes('releaseDate')) return Promise.resolve([{ year: 2025 }, { year: 2024 }]);
    if (text.includes('createdNonFinite')) return Promise.resolve([timeRow('s1')]);
    return Promise.resolve([]);
  });
  const transaction = jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
  const prisma = {
    series: { findMany, count, findUnique },
    $queryRaw: queryRaw,
    $transaction: transaction,
  } as unknown as PrismaService;
  const caller = new SeriesRouter(new TrpcBase(), prisma).build().createCaller({
    req: {} as never,
    res: {} as never,
    user: null,
  });
  return { caller, findMany, count, queryRaw };
}

const seriesRow = {
  id: 's1',
  slug: 'celestial-dawn',
  title: '天穹黎明',
  description: null,
  coverUrl: null,
  releaseDate: new Date('2024-03-15T00:00:00.000Z'),
  category: { slug: 'deck-builder', name: '构筑对战' },
  _count: { cards: 4 },
};

describe('SeriesRouter.list taxonomy filters', () => {
  it('keeps createdAt ascending when sort is omitted and returns unfiltered years', async () => {
    const { caller, findMany, count } = makeRouter();
    findMany.mockResolvedValueOnce([seriesRow]);
    count.mockResolvedValueOnce(1);

    const result = await caller.list();

    expect(findMany.mock.calls[0]?.[0].orderBy).toEqual([{ createdAt: 'asc' }]);
    expect(findMany.mock.calls[0]?.[0].where).toEqual({});
    expect(result.years).toEqual([2025, 2024]);
    expect(result.items[0]).toMatchObject({
      slug: 'celestial-dawn',
      releaseDate: '2024-03-15',
      category: { slug: 'deck-builder', name: '构筑对战' },
      cardCount: 4,
    });
    expect(result.total).toBe(1);
  });

  it('filters by category and year and sorts release dates with nulls last', async () => {
    const { caller, findMany, count } = makeRouter();
    findMany.mockResolvedValueOnce([]);
    count.mockResolvedValueOnce(0);

    await caller.list({
      categorySlug: 'deck-builder',
      year: 2024,
      sort: 'releaseDateDesc',
    });

    const args = findMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({
      category: { slug: 'deck-builder' },
      releaseDate: {
        gte: new Date(Date.UTC(2024, 0, 1)),
        lt: new Date(Date.UTC(2025, 0, 1)),
      },
    });
    expect(args.orderBy).toEqual([
      { releaseDate: { sort: 'desc', nulls: 'last' } },
      { title: 'asc' },
      { slug: 'asc' },
    ]);
    expect(count).toHaveBeenCalledWith({ where: args.where });
  });

  it('rejects a year outside 1–9999 before querying', async () => {
    const { caller, findMany } = makeRouter();

    await expect(caller.list({ year: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(findMany).not.toHaveBeenCalled();
  });
});
