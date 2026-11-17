import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import {
  cardAttributeLabels,
  cardRarityCode,
  isSelectableCardRarityCode,
  type CardsListBySeriesInput,
} from '@repo/shared';
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
  subset: { select: { slug: true, sortOrder: true } },
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
  /** CH-239: trimmed `attributes.稀有度`, or null when the card has none. */
  rarityCode: string | null;
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
  /**
   * CH-239: every official rarity code in the series (base and parallels),
   * in the order each first appears under `sort=number`. Filters and paging
   * do not change it. Empty when no card has `attributes.稀有度`. Codes longer
   * than the `rarityCode` input limit are left out because no filter can
   * select them.
   */
  rarityCodes: string[];
  /**
   * CH-239 需求 v1.1 / Spec v1.2 §3: the codes printed on at least one base
   * card (`parallelOfId` null), in `rarityCodes` order. The page offers these
   * while 「显示平行版本」 is off; a code in `rarityCodes` but not here is
   * printed only on parallels. Filters, including `includeParallels`, and
   * paging do not change it.
   */
  baseRarityCodes: string[];
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
    rarityCode: cardRarityCode(card.attributes),
  };
}

function seriesRarityCodes(cards: readonly ListedCardRow[]): string[] {
  const codes = new Set<string>();
  const byNumber = [...cards].sort((left, right) => compareSeriesListCards('number', left, right));
  for (const card of byNumber) {
    const code = cardRarityCode(card.attributes);
    if (code !== null && isSelectableCardRarityCode(code)) codes.add(code);
  }
  return [...codes];
}

function baseRarityCodes(cards: readonly ListedCardRow[], ordered: readonly string[]): string[] {
  const onBase = new Set<string>();
  for (const card of cards) {
    if (card.parallelOfId != null) continue;
    const code = cardRarityCode(card.attributes);
    if (code !== null) onBase.add(code);
  }
  return ordered.filter((code) => onBase.has(code));
}

function matchesFilters(card: ListedCardRow, input: CardsListBySeriesInput): boolean {
  if (!input.includeParallels && card.parallelOfId != null) return false;
  if (input.rarity && card.rarity !== input.rarity) return false;
  if (input.subsetSlug && card.subset?.slug !== input.subsetSlug) return false;
  if (input.rarityCode && cardRarityCode(card.attributes) !== input.rarityCode) return false;
  return true;
}

/**
 * One series read joins all of its cards and the unfiltered card count.
 * Filtering, sorting, and paging happen in memory so the printed-number order
 * does not need a stored key and `rarityCodes` can be built from the whole
 * series in the same read (CH-239). `cards_seriesId_idx` bounds the read;
 * parallels, subset, rarity, official rarity code, and keyword are filters on
 * that set. `seriesTotal` counts base cards only
 * (`parallelOfId` null) and does not follow filters. `includeParallels`
 * defaults to false and drops rows with `parallelOfId` before the keyword
 * filter. `parallelCount` is a separate count of those rows and does not
 * follow filters.
 */
export async function loadCardsBySeries(
  prisma: PrismaService,
  input: CardsListBySeriesInput,
): Promise<CardsListBySeriesResult> {
  const [series, parallelCount] = await Promise.all([
    prisma.series.findUnique({
      where: { slug: input.seriesSlug },
      select: {
        _count: { select: { cards: { where: { parallelOfId: null } } } },
        cards: { select: cardSelect },
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
  const matched = series.cards.filter((card) => {
    if (!matchesFilters(card, input)) return false;
    if (!needle) return true;
    if (card.name.toLocaleLowerCase('en-US').includes(needle)) return true;
    return (card.cardNumber ?? '').toLocaleLowerCase('en-US').includes(needle);
  });

  const sorted = [...matched].sort((left, right) =>
    compareSeriesListCards(input.sort, left, right),
  );
  const start = (input.page - 1) * input.pageSize;
  const rarityCodes = seriesRarityCodes(series.cards);
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
    rarityCodes,
    baseRarityCodes: baseRarityCodes(series.cards, rarityCodes),
  };
}
