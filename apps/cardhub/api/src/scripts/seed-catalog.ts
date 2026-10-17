/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';

import { CATALOG_SERIES } from './seed-data';

export async function seedCatalog(prisma: PrismaClient) {
  for (const series of CATALOG_SERIES) {
    const upsertedSeries = await prisma.series.upsert({
      where: { slug: series.slug },
      update: {},
      create: {
        slug: series.slug,
        title: series.title,
        description: series.description,
        coverUrl: series.coverUrl,
      },
    });

    for (const card of series.cards) {
      await prisma.card.upsert({
        where: { slug: card.slug },
        update: {},
        create: {
          slug: card.slug,
          name: card.name,
          description: card.description,
          imageUrl: card.imageUrl,
          rarity: card.rarity,
          attributes: card.attributes,
          seriesId: upsertedSeries.id,
        },
      });
    }
  }

  return {
    expectedSeries: CATALOG_SERIES.length,
    expectedCards: CATALOG_SERIES.reduce((count, series) => count + series.cards.length, 0),
    series: await prisma.series.count(),
    cards: await prisma.card.count(),
  };
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const counts = await seedCatalog(prisma);
    const users = await prisma.user.count();
    console.log(
      `Catalog seed complete. Series: ${counts.series}/${counts.expectedSeries}, Cards: ${counts.cards}/${counts.expectedCards}, Users: ${users}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
