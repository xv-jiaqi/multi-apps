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

  return { prisma, seriesUpsert, cardUpsert, userUpsert, userCreate };
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

  it('does not overwrite existing catalog rows', async () => {
    const { prisma, seriesUpsert, cardUpsert } = makePrisma();

    await seedCatalog(prisma);

    const seriesCalls = seriesUpsert.mock.calls as unknown as Array<[{ update?: unknown }]>;
    const cardCalls = cardUpsert.mock.calls as unknown as Array<[{ update?: unknown }]>;
    const firstSeriesArgs = seriesCalls[0]?.[0];
    const firstCardArgs = cardCalls[0]?.[0];
    expect(firstSeriesArgs?.update).toEqual({});
    expect(firstCardArgs?.update).toEqual({});
  });
});
