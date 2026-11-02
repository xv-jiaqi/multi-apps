import type { PrismaService } from '../prisma/prisma.service';
import { compareSeriesListCards } from './card-list-order';

export type AdjacentCard = { slug: string; name: string; imageUrl: string | null };
export type CardAdjacent = { prev: AdjacentCard | null; next: AdjacentCard | null };

/**
 * CH-206 §5 / §11-3. Neighbours among base cards (parallelOfId null) in the
 * same subset; with no subset, among the series' base cards that have no
 * subset. A parallel uses its base card's place. Order is CH-202 §3 card
 * number order with ties on id, so it matches the series page. Orphans are
 * ordinary base cards; parallelName plays no part.
 *
 * Read fresh on every request (not cached with bySlug): any neighbour's
 * edit would otherwise leave the cached links stale.
 */
export async function loadCardAdjacent(prisma: PrismaService, slug: string): Promise<CardAdjacent> {
  const card = await prisma.card.findUnique({
    where: { slug },
    select: {
      id: true,
      seriesId: true,
      subsetId: true,
      parallelOf: { select: { id: true, seriesId: true, subsetId: true } },
    },
  });
  if (!card) return { prev: null, next: null };
  const base = card.parallelOf ?? card;
  const scope = await prisma.card.findMany({
    where: { seriesId: base.seriesId, subsetId: base.subsetId, parallelOfId: null },
    select: {
      id: true,
      slug: true,
      name: true,
      imageUrl: true,
      cardNumber: true,
      rarity: true,
      createdAt: true,
    },
  });
  scope.sort((left, right) => compareSeriesListCards('number', left, right));
  const index = scope.findIndex((row) => row.id === base.id);
  if (index < 0) return { prev: null, next: null };
  const pick = (row: (typeof scope)[number] | undefined): AdjacentCard | null =>
    row ? { slug: row.slug, name: row.name, imageUrl: row.imageUrl } : null;
  return { prev: pick(scope[index - 1]), next: pick(scope[index + 1]) };
}
