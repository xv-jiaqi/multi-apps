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
};

export type CardsListBySeriesResult = {
  items: CardsListBySeriesItem[];
  page: number;
  pageSize: number;
  total: number;
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
  };
}

/**
 * One series read joins its cards. Sorting and paging happen in memory so the
 * printed-number order does not need a stored key. `cards_seriesId_idx` already
 * bounds the read; subset, rarity, and keyword are filters on that set.
 */
export async function loadCardsBySeries(
  prisma: PrismaService,
  input: CardsListBySeriesInput,
): Promise<CardsListBySeriesResult> {
  const where: Prisma.CardWhereInput = {};
  if (input.rarity) where.rarity = input.rarity;
  if (input.subsetSlug) where.subset = { slug: input.subsetSlug };

  const series = await prisma.series.findUnique({
    where: { slug: input.seriesSlug },
    select: {
      cards: { where, select: cardSelect },
    },
  });
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
    sort: input.sort,
    attributeLabels: cardAttributeLabels(
      sorted.flatMap((card) => Object.keys(flatCardAttributes(card.attributes) ?? {})),
    ),
  };
}
