import { RARITY_VALUES, compareCardNumbers, type CardSeriesListSort } from '@repo/shared';

export type SeriesListSortCard = {
  id: string;
  name: string;
  rarity: string | null;
  cardNumber: string | null;
  createdAt: Date;
  slug?: string;
  parallelOfId?: string | null;
  parallelName?: string | null;
  printRun?: number | null;
};

export type VariantSortCard = {
  isParallel: boolean;
  printRun: number | null;
  parallelName: string | null;
  slug: string;
};

const RARITY_RANK = new Map<string, number>(RARITY_VALUES.map((value, index) => [value, index]));

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareRarity(left: string | null, right: string | null): number {
  const rank = (value: string | null) => {
    const text = value?.trim() ?? '';
    if (!text) return { group: 2, order: 0, text: '' };
    const known = RARITY_RANK.get(text);
    if (known !== undefined) return { group: 0, order: known, text: '' };
    return { group: 1, order: 0, text };
  };
  const a = rank(left);
  const b = rank(right);
  if (a.group !== b.group) return a.group - b.group;
  if (a.order !== b.order) return a.order - b.order;
  return compareText(a.text, b.text);
}

function compareCreated(left: Date, right: Date): number {
  const a = left.getTime();
  const b = right.getTime();
  const aBad = Number.isNaN(a);
  const bBad = Number.isNaN(b);
  if (aBad || bBad) {
    if (aBad && bBad) return 0;
    return aBad ? 1 : -1;
  }
  return a - b;
}

function variantView(card: SeriesListSortCard): VariantSortCard {
  return {
    isParallel: typeof card.parallelOfId === 'string' && card.parallelOfId.length > 0,
    printRun: typeof card.printRun === 'number' ? card.printRun : null,
    parallelName: typeof card.parallelName === 'string' ? card.parallelName : null,
    slug: card.slug ?? card.id,
  };
}

/**
 * Base cards compare equal here so the caller can keep its own tie-break.
 * Two parallels: unnumbered first, then printRun descending, then parallelName
 * (`zh-CN`), then slug. A base sorts before a parallel.
 */
export function compareParallelTail(left: VariantSortCard, right: VariantSortCard): number {
  if (left.isParallel !== right.isParallel) return left.isParallel ? 1 : -1;
  if (!left.isParallel || !right.isParallel) return 0;
  const leftUnnumbered = left.printRun === null;
  const rightUnnumbered = right.printRun === null;
  if (leftUnnumbered !== rightUnnumbered) return leftUnnumbered ? -1 : 1;
  if (left.printRun !== null && right.printRun !== null && left.printRun !== right.printRun) {
    return right.printRun - left.printRun;
  }
  const byName = (left.parallelName ?? '').localeCompare(right.parallelName ?? '', 'zh-CN');
  if (byName !== 0) return byName;
  return compareText(left.slug, right.slug);
}

/** Whole parallel group: base first, then the parallel tail, then slug. */
export function compareVariantGroup(left: VariantSortCard, right: VariantSortCard): number {
  const tail = compareParallelTail(left, right);
  if (tail !== 0) return tail;
  return compareText(left.slug, right.slug);
}

function primaryCompare(
  sort: CardSeriesListSort,
  left: SeriesListSortCard,
  right: SeriesListSortCard,
) {
  switch (sort) {
    case 'name':
      return left.name.localeCompare(right.name, 'zh-CN', {
        numeric: true,
        sensitivity: 'variant',
      });
    case 'rarity':
      return compareRarity(left.rarity, right.rarity);
    case 'created':
      return compareCreated(left.createdAt, right.createdAt);
    case 'number': {
      const byNumber = compareCardNumbers(left.cardNumber, right.cardNumber);
      if (byNumber !== 0) return byNumber;
      return compareParallelTail(variantView(left), variantView(right));
    }
  }
}

/** Equal keys break on id so the page order does not depend on the database. */
export function compareSeriesListCards(
  sort: CardSeriesListSort,
  left: SeriesListSortCard,
  right: SeriesListSortCard,
): number {
  const primary = primaryCompare(sort, left, right);
  if (primary !== 0) return primary;
  return compareText(left.id, right.id);
}
