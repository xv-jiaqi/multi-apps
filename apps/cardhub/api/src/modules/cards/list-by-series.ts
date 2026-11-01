import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { cardAttributeLabels, type CardsListBySeriesInput } from '@repo/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { compareSeriesListCards } from './card-list-order';

type AttributeValue = string | number | boolean | null;

const cardSelect = {
  id: true,
  slug: true,
  name: true,
  rarity: true,
  imageUrl: true,
  cardNumber: true,
  attributes: true,
  createdAt: true,
  parallelOfId: true,
  parallelName: true,
  printRun: true,
  subset: { select: { slug: true } },
} as const;

type ListedCardRow = Prisma.CardGetPayload<{ select: typeof cardSelect }>;

export type CardsListBySeriesItem = {
  id: string;
  slug: string;
  name: string;
  rarity: string | null;
  imageUrl: string | null;
  cardNumber: string | null;
  subsetSlug: string | null;
  attributes: Record<string, AttributeValue> | null;
  parallelName: string | null;
  printRun: number | null;
  isParallel: boolean;
};

export type CardsListBySeriesResult = {
  items: CardsListBySeriesItem[];
  page: number;
  pageSize: number;
  total: number;
  /**
   * Cards in the series, ignoring q / rarity / subset. Optional in the
   * contract so an older payload still parses; this loader always sets it.
   */
  seriesTotal?: number;
  /** Parallels in the series. Filters do not change this count. */
  parallelCount: number;
  sort: CardsListBySeriesInput['sort'];
  attributeLabels: ReturnType<typeof cardAttributeLabels>;
};

/**
 * Keep only scalar attribute values. Nested JSON is not part of this list
 * contract, and the admin editor cannot write it. Dropping it keeps the
 * public cache schema able to store the payload.
 */
export function flatCardAttributes(value: unknown): Record<string, AttributeValue> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const attributes: Record<string, AttributeValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      item === null ||
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    ) {
      attributes[key] = item;
    }
  }
  return attributes;
}

function toListItem(card: ListedCardRow): CardsListBySeriesItem {
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    cardNumber: card.cardNumber,
    subsetSlug: card.subset?.slug ?? null,
    attributes: flatCardAttributes(card.attributes),
    parallelName: card.parallelName ?? null,
    printRun: card.printRun ?? null,
    isParallel: card.parallelOfId != null,
  };
}

/**
 * One series read joins its cards and the unfiltered card count. Sorting and
 * paging happen in memory so the printed-number order does not need a stored
 * key. `cards_seriesId_idx` already bounds the read; subset, rarity, and
 * keyword are filters on that set. `seriesTotal` reuses that count and does
 * not follow filters. `includeParallels` defaults to false and drops rows
 * with `parallelOfId` before the keyword filter. `parallelCount` is a separate
 * count of those rows and does not follow filters.
 */
export async function loadCardsBySeries(
  prisma: PrismaService,
  input: CardsListBySeriesInput,
): Promise<CardsListBySeriesResult> {
  const where: Prisma.CardWhereInput = {};
  if (!input.includeParallels) where.parallelOfId = null;
  if (input.rarity) where.rarity = input.rarity;
  if (input.subsetSlug) where.subset = { slug: input.subsetSlug };

  const [series, parallelCount] = await Promise.all([
    prisma.series.findUnique({
      where: { slug: input.seriesSlug },
      select: {
        _count: { select: { cards: true } },
        cards: { where, select: cardSelect },
      },
    }),
    prisma.card.count({
      where: { series: { slug: input.seriesSlug }, parallelOfId: { not: null } },
    }),
  ]);
  if (!series) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' });
  }

  // Keyword stays in process. Postgres LIKE would treat `%` and `_` in `q`
  // as wildcards, and the series rows are already loaded for card-number order.
  const needle = input.q?.toLocaleLowerCase('en-US');
  const matched = needle
    ? series.cards.filter((card) => {
        if (card.name.toLocaleLowerCase('en-US').includes(needle)) return true;
        return (card.cardNumber ?? '').toLocaleLowerCase('en-US').includes(needle);
      })
    : series.cards;

  const sorted = [...matched].sort((left, right) =>
    compareSeriesListCards(input.sort, left, right),
  );
  const start = (input.page - 1) * input.pageSize;
  return {
    items: sorted.slice(start, start + input.pageSize).map(toListItem),
    page: input.page,
    pageSize: input.pageSize,
    total: sorted.length,
    seriesTotal: series._count.cards,
    parallelCount,
    sort: input.sort,
    attributeLabels: cardAttributeLabels(
      sorted.flatMap((card) => Object.keys(flatCardAttributes(card.attributes) ?? {})),
    ),
  };
}
