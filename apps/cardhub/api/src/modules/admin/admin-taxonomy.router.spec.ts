import { TrpcBase } from '../../trpc/trpc-base';
import type { PrismaService } from '../prisma/prisma.service';
import type { TrpcContext } from '../../trpc/context';
import { AdminRouter } from './admin.router';

function adminUser(): NonNullable<TrpcContext['user']> {
  return { sub: 'u-admin', username: 'admin', role: 'admin', tokenVersion: 0, bannedAt: null };
}

function makeRouter() {
  const categoryFindMany = jest.fn();
  const categoryFindUnique = jest.fn();
  const categoryCreate = jest.fn();
  const categoryUpdate = jest.fn();
  const categoryDelete = jest.fn();
  const seriesFindUnique = jest.fn();
  const subsetFindMany = jest.fn();
  const subsetFindUnique = jest.fn();
  const subsetCreate = jest.fn();
  const subsetUpdate = jest.fn();
  const subsetDelete = jest.fn();
  const prisma = {
    category: {
      findMany: categoryFindMany,
      findUnique: categoryFindUnique,
      create: categoryCreate,
      update: categoryUpdate,
      delete: categoryDelete,
    },
    series: { findUnique: seriesFindUnique },
    subset: {
      findMany: subsetFindMany,
      findUnique: subsetFindUnique,
      create: subsetCreate,
      update: subsetUpdate,
      delete: subsetDelete,
    },
  } as unknown as PrismaService;
  const caller = new AdminRouter(new TrpcBase(), prisma).build().createCaller({
    req: {} as never,
    res: {} as never,
    user: adminUser(),
  });
  return {
    caller,
    categoryFindUnique,
    categoryCreate,
    categoryUpdate,
    categoryDelete,
    seriesFindUnique,
    subsetFindUnique,
    subsetCreate,
    subsetDelete,
  };
}

const categoryRow = {
  id: 'cat-1',
  slug: 'deck-builder',
  name: '构筑对战',
  description: null,
  sortOrder: 0,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  _count: { series: 2 },
};

describe('Admin taxonomy writes', () => {
  it('creates a category and maps a duplicate slug to SLUG_TAKEN', async () => {
    const created = makeRouter();
    created.categoryCreate.mockResolvedValueOnce(categoryRow);

    await expect(
      created.caller.categories.create({ slug: 'deck-builder', name: '构筑对战', description: '' }),
    ).resolves.toMatchObject({ slug: 'deck-builder', seriesCount: 2, description: null });
    expect(created.categoryCreate.mock.calls[0]?.[0].data).toMatchObject({
      slug: 'deck-builder',
      description: null,
      sortOrder: 0,
    });

    const duplicate = makeRouter();
    duplicate.categoryCreate.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      duplicate.caller.categories.create({ slug: 'deck-builder', name: '构筑对战' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', cause: { code: 'SLUG_TAKEN' } });
  });

  it('returns NOT_FOUND when updating or deleting a missing category', async () => {
    const missingUpdate = makeRouter();
    missingUpdate.categoryUpdate.mockRejectedValueOnce({ code: 'P2025' });
    await expect(
      missingUpdate.caller.categories.update({ slug: 'missing', name: '缺失' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: '品类不存在' });

    const missingDelete = makeRouter();
    missingDelete.categoryFindUnique.mockResolvedValueOnce(null);
    await expect(missingDelete.caller.categories.delete({ slug: 'missing' })).rejects.toMatchObject(
      { code: 'NOT_FOUND', message: '品类不存在' },
    );
    expect(missingDelete.categoryDelete).not.toHaveBeenCalled();
  });

  it('rejects an overlong card number and an impossible release date', async () => {
    const { caller, categoryCreate, seriesFindUnique } = makeRouter();

    await expect(caller.categories.create({ slug: 'OK', name: '名称' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.series.create({
        slug: 'new-series',
        title: 'New',
        releaseDate: '2024-02-31',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.cards.create({
        slug: 'new-card',
        name: 'New',
        rarity: 'common',
        attributes: {},
        seriesSlug: 'new-series',
        cardNumber: '123456789012345678901',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(categoryCreate).not.toHaveBeenCalled();
    expect(seriesFindUnique).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the subset series does not exist', async () => {
    const { caller, seriesFindUnique, subsetCreate } = makeRouter();
    seriesFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller.subsets.create({
        seriesSlug: 'missing-series',
        slug: 'base',
        name: '主卡',
        kind: 'BASE',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      cause: { code: 'SERIES_NOT_FOUND' },
    });
    expect(subsetCreate).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when deleting a missing subset and does not delete cards', async () => {
    const { caller, seriesFindUnique, subsetFindUnique, subsetDelete } = makeRouter();
    seriesFindUnique.mockResolvedValueOnce({ id: 's1' });
    subsetFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller.subsets.delete({ seriesSlug: 'celestial-dawn', slug: 'base' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: '子集不存在' });
    expect(subsetDelete).not.toHaveBeenCalled();
  });
});
