import type { PrismaClient } from '@prisma/client';

import { seedCatalog } from './seed-catalog';
import { CATALOG_SERIES } from './seed-data';

function makePrisma() {
  const seriesUpsert = jest.fn(({ where }) => Promise.resolve({ id: `series-${where.slug}` }));
  const cardUpsert = jest.fn(() => Promise.resolve({}));
  const seriesCount = jest.fn(() => Promise.resolve(CATALOG_SERIES.length));
  const cardCount = jest.fn(() =>
    Promise.resolve(CATALOG_SERIES.reduce((total, series) => total + series.cards.length, 0)),
  );
  const userUpsert = jest.fn();
  const userCreate = jest.fn();

  const prisma = {
    series: { upsert: seriesUpsert, count: seriesCount },
    card: { upsert: cardUpsert, count: cardCount },
    user: { upsert: userUpsert, create: userCreate },
  } as unknown as PrismaClient;

  return { prisma, seriesUpsert, cardUpsert, seriesCount, cardCount, userUpsert, userCreate };
}

describe('seedCatalog', () => {
  it('upserts only the catalog series/cards and never writes users', async () => {
    const { prisma, seriesUpsert, cardUpsert, userUpsert, userCreate } = makePrisma();

    await seedCatalog(prisma);
    await seedCatalog(prisma);

    expect(seriesUpsert).toHaveBeenCalledTimes(CATALOG_SERIES.length * 2);
    expect(cardUpsert).toHaveBeenCalledTimes(
      CATALOG_SERIES.reduce((total, series) => total + series.cards.length, 0) * 2,
    );
    expect(userUpsert).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('counts only seeded slugs instead of whole-table rows', async () => {
    const { prisma, seriesCount, cardCount } = makePrisma();

    await seedCatalog(prisma);

    expect(seriesCount).toHaveBeenCalledWith({
      where: { slug: { in: CATALOG_SERIES.map((series) => series.slug) } },
    });
    expect(cardCount).toHaveBeenCalledWith({
      where: {
        slug: { in: CATALOG_SERIES.flatMap((series) => series.cards.map((card) => card.slug)) },
      },
    });
  });
});
