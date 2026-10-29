/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';

import { CATALOG_CATEGORY, CATALOG_SERIES } from './seed-data';

export async function seedCatalog(prisma: PrismaClient) {
  // Insert-only. A second run must not overwrite category, subset, or card
  // edits made in the admin catalog.
  await prisma.category.upsert({
    where: { slug: CATALOG_CATEGORY.slug },
    update: {},
    create: {
      slug: CATALOG_CATEGORY.slug,
      name: CATALOG_CATEGORY.name,
      description: CATALOG_CATEGORY.description,
      sortOrder: CATALOG_CATEGORY.sortOrder,
    },
  });

  for (const series of CATALOG_SERIES) {
    const upsertedSeries = await prisma.series.upsert({
      where: { slug: series.slug },
      update: {},
      create: {
        slug: series.slug,
        title: series.title,
        description: series.description,
        coverUrl: series.coverUrl,
        category: { connect: { slug: CATALOG_CATEGORY.slug } },
        releaseDate: series.releaseDate ? new Date(`${series.releaseDate}T00:00:00.000Z`) : null,
      },
    });

    const subsetIds = new Map<string, string>();
    for (const subset of series.subsets) {
      const savedSubset = await prisma.subset.upsert({
        where: { seriesId_slug: { seriesId: upsertedSeries.id, slug: subset.slug } },
        update: {},
        create: {
          seriesId: upsertedSeries.id,
          slug: subset.slug,
          name: subset.name,
          kind: subset.kind,
          sortOrder: subset.sortOrder,
        },
      });
      subsetIds.set(subset.slug, savedSubset.id);
    }

    for (const card of series.cards) {
      const subsetId = card.subsetSlug ? subsetIds.get(card.subsetSlug) : undefined;
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
          cardNumber: card.cardNumber ?? null,
          ...(subsetId ? { subsetId } : {}),
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
