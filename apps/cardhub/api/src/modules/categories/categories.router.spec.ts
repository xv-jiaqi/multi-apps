import { TrpcBase } from '../../trpc/trpc-base';
import { CategoriesRouter } from './categories.router';
import type { PrismaService } from '../prisma/prisma.service';

function makeRouter() {
  const categoryFindMany = jest.fn();
  const categoryFindUnique = jest.fn();
  const queryRaw = jest.fn();
  const prisma = {
    category: { findMany: categoryFindMany, findUnique: categoryFindUnique },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  const caller = new CategoriesRouter(new TrpcBase(), prisma).build().createCaller({
    req: {} as never,
    res: {} as never,
    user: null,
  });
  return { caller, categoryFindMany, categoryFindUnique, queryRaw };
}

describe('CategoriesRouter', () => {
  it('lists categories with series counts, sorted by sortOrder then name', async () => {
    const { caller, categoryFindMany } = makeRouter();
    categoryFindMany.mockResolvedValueOnce([
      {
        id: 'c1',
        slug: 'deck-builder',
        name: '构筑对战',
        description: null,
        sortOrder: 0,
        _count: { series: 3 },
      },
    ]);

    await expect(caller.list()).resolves.toEqual({
      items: [
        {
          id: 'c1',
          slug: 'deck-builder',
          name: '构筑对战',
          description: null,
          sortOrder: 0,
          seriesCount: 3,
        },
      ],
    });
    expect(categoryFindMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { slug: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        sortOrder: true,
        _count: { select: { series: true } },
      },
    });
  });

  it('returns NOT_FOUND for a missing category', async () => {
    const { caller, categoryFindUnique } = makeRouter();
    categoryFindUnique.mockResolvedValueOnce(null);

    await expect(caller.bySlug({ slug: 'missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '品类不存在',
    });
  });

  it('rejects a slug that is not kebab-case before querying', async () => {
    const { caller, categoryFindUnique } = makeRouter();

    await expect(caller.bySlug({ slug: 'Not A Slug' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(categoryFindUnique).not.toHaveBeenCalled();
  });
});
