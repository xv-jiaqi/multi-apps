import type { PrismaClient } from '@prisma/client';

import { seedCatalog } from './seed-catalog';
import { CATALOG_SERIES } from './seed-data';

function subsetCount() {
  return CATALOG_SERIES.reduce((total, series) => total + series.subsets.length, 0);
}

function makePrisma() {
  const categoryUpsert = jest.fn(() => Promise.resolve({ id: 'category-deck-builder' }));
  const seriesUpsert = jest.fn(({ where }) => Promise.resolve({ id: `series-${where.slug}` }));
  const subsetUpsert = jest.fn(() => Promise.resolve({}));
  const cardUpsert = jest.fn(() => Promise.resolve({}));
  const seriesCount = jest.fn(() => Promise.resolve(CATALOG_SERIES.length));
  const cardCount = jest.fn(() =>
    Promise.resolve(CATALOG_SERIES.reduce((total, series) => total + series.cards.length, 0)),
  );
  const userUpsert = jest.fn();
  const userCreate = jest.fn();

  const prisma = {
    category: { upsert: categoryUpsert },
    series: { upsert: seriesUpsert, count: seriesCount },
    subset: { upsert: subsetUpsert },
    card: { upsert: cardUpsert, count: cardCount },
    user: { upsert: userUpsert, create: userCreate },
  } as unknown as PrismaClient;

  return { prisma, categoryUpsert, seriesUpsert, subsetUpsert, cardUpsert, userUpsert, userCreate };
}

describe('seedCatalog', () => {
  it('upserts only the catalog series/cards and never writes users', async () => {
    const {
      prisma,
      categoryUpsert,
      seriesUpsert,
      subsetUpsert,
      cardUpsert,
      userUpsert,
      userCreate,
    } = makePrisma();

    await seedCatalog(prisma);
    await seedCatalog(prisma);

    expect(categoryUpsert).toHaveBeenCalledTimes(2);
    expect(seriesUpsert).toHaveBeenCalledTimes(CATALOG_SERIES.length * 2);
    expect(subsetUpsert).toHaveBeenCalledTimes(subsetCount() * 2);
    expect(cardUpsert).toHaveBeenCalledTimes(
      CATALOG_SERIES.reduce((total, series) => total + series.cards.length, 0) * 2,
    );
    expect(userUpsert).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('does not overwrite existing catalog rows', async () => {
    const { prisma, categoryUpsert, seriesUpsert, subsetUpsert, cardUpsert } = makePrisma();

    await seedCatalog(prisma);

    const categoryCalls = categoryUpsert.mock.calls as unknown as Array<[{ update?: unknown }]>;
    const seriesCalls = seriesUpsert.mock.calls as unknown as Array<[{ update?: unknown }]>;
    const subsetCalls = subsetUpsert.mock.calls as unknown as Array<[{ update?: unknown }]>;
    const cardCalls = cardUpsert.mock.calls as unknown as Array<[{ update?: unknown }]>;
    expect(categoryCalls[0]?.[0]?.update).toEqual({});
    expect(seriesCalls[0]?.[0]?.update).toEqual({});
    expect(subsetCalls[0]?.[0]?.update).toEqual({});
    expect(cardCalls[0]?.[0]?.update).toEqual({});
  });
});
