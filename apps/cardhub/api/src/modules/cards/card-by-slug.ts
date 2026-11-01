import { TRPCError } from '@trpc/server';
import type { PrismaService } from '../prisma/prisma.service';
import { compareVariantGroup, type VariantSortCard } from './card-list-order';
import { flatCardAttributes } from './list-by-series';

type AttributeValue = string | number | boolean | null;

export type CardVariant = {
  slug: string;
  name: string;
  parallelName: string | null;
  printRun: number | null;
  imageUrl: string | null;
  isCurrent: boolean;
};

export type CardBySlugResult = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  rarity: string | null;
  attributes: Record<string, AttributeValue> | null;
  seriesSlug: string;
  seriesTitle: string;
  cardNumber: string | null;
  subset: { slug: string; name: string; kind: 'BASE' | 'INSERT' } | null;
  createdAt: string;
  updatedAt: string;
  printRun: number | null;
  parallelName: string | null;
  base: { slug: string; name: string } | null;
  variants: CardVariant[];
};

type GroupRow = {
  id: string;
  slug: string;
  name: string;
  parallelName: string | null;
  printRun: number | null;
  imageUrl: string | null;
  parallelOfId: string | null;
};

function groupRow(card: {
  id: string;
  slug: string;
  name: string;
  parallelName?: string | null;
  printRun?: number | null;
  imageUrl?: string | null;
  parallelOfId?: string | null;
}): GroupRow {
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    parallelName: card.parallelName ?? null,
    printRun: card.printRun ?? null,
    imageUrl: card.imageUrl ?? null,
    parallelOfId: card.parallelOfId ?? null,
  };
}

function toVariant(row: GroupRow, currentId: string): CardVariant & VariantSortCard {
  const isParallel = row.parallelOfId !== null;
  return {
    slug: row.slug,
    name: row.name,
    parallelName: row.parallelName,
    printRun: row.printRun,
    imageUrl: row.imageUrl,
    isCurrent: row.id === currentId,
    isParallel,
  };
}

/**
 * One card plus its parallel group. The group is the base and every card
 * that points at that base, including the card being read. Sort matches
 * CH-213 §5: base, then unnumbered, then printRun descending, then name, then slug.
 */
export async function loadCardBySlug(
  prisma: PrismaService,
  slug: string,
): Promise<CardBySlugResult> {
  const card = await prisma.card.findUnique({
    where: { slug },
    include: {
      series: { select: { slug: true, title: true } },
      subset: { select: { slug: true, name: true, kind: true } },
      parallelOf: { select: { id: true, slug: true, name: true } },
    },
  });
  if (!card) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '卡牌不存在' });
  }

  const baseId = card.parallelOf?.id ?? card.id;
  const found = await prisma.card.findMany({
    where: { OR: [{ id: baseId }, { parallelOfId: baseId }] },
    select: {
      id: true,
      slug: true,
      name: true,
      parallelName: true,
      printRun: true,
      imageUrl: true,
      parallelOfId: true,
    },
  });
  const rows = found.some((row) => row.id === card.id) ? found : [groupRow(card), ...found];
  const variants = rows
    .map((row) => toVariant(groupRow(row), card.id))
    .sort((left, right) => compareVariantGroup(left, right))
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      parallelName: row.parallelName,
      printRun: row.printRun,
      imageUrl: row.imageUrl,
      isCurrent: row.isCurrent,
    }));

  const subsetKind = card.subset?.kind;
  const subset =
    card.subset && (subsetKind === 'BASE' || subsetKind === 'INSERT')
      ? { slug: card.subset.slug, name: card.subset.name, kind: subsetKind }
      : null;

  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    description: card.description,
    imageUrl: card.imageUrl,
    rarity: card.rarity,
    attributes: flatCardAttributes(card.attributes),
    seriesSlug: card.series.slug,
    seriesTitle: card.series.title,
    cardNumber: card.cardNumber ?? null,
    subset,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    printRun: card.printRun ?? null,
    parallelName: card.parallelName ?? null,
    base: card.parallelOf ? { slug: card.parallelOf.slug, name: card.parallelOf.name } : null,
    variants,
  };
}
