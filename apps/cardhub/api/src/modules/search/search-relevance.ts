import { compareSeriesListCards, type SeriesListSortCard } from '../cards/card-list-order';

/** 0 = name equals the term, 1 = name starts with it, 2 = any other hit. */
export type RelevanceTier = 0 | 1 | 2;

export type RelevanceSortCard = SeriesListSortCard & {
  series: { slug: string; releaseDate: Date | null };
};

function fold(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

/**
 * CH-241 §1 tiers 1–3. `term` is the first positive bare word
 * (`relevanceSearchTerm`). Case-insensitive like the ILIKE that found the row.
 * Without a bare word every row is tier 2, so only §1 rule 4 orders them.
 */
export function relevanceTier(name: string, term: string | undefined): RelevanceTier {
  if (term === undefined) return 2;
  const folded = fold(name);
  const needle = fold(term);
  if (folded === needle) return 0;
  if (folded.startsWith(needle)) return 1;
  return 2;
}

/** Newer release first. A series without a release date goes last. */
function compareRelease(left: Date | null, right: Date | null): number {
  if (left === null || right === null) {
    if (left === right) return 0;
    return left === null ? 1 : -1;
  }
  return right.getTime() - left.getTime();
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * CH-241 §1: tier, then series release date (new to old, null last), then the
 * series slug so two series released the same day do not interleave, then
 * `cards.listBySeries` `sort:'number'` order, which ends on id. That makes it
 * a total order, so pages cut from it never repeat or skip a card.
 */
export function sortByRelevance<T extends RelevanceSortCard>(
  cards: readonly T[],
  term: string | undefined,
): T[] {
  const ranked = cards.map((card) => ({ card, tier: relevanceTier(card.name, term) }));
  ranked.sort((left, right) => {
    if (left.tier !== right.tier) return left.tier - right.tier;
    const byRelease = compareRelease(left.card.series.releaseDate, right.card.series.releaseDate);
    if (byRelease !== 0) return byRelease;
    const bySeries = compareText(left.card.series.slug, right.card.series.slug);
    if (bySeries !== 0) return bySeries;
    return compareSeriesListCards('number', left.card, right.card);
  });
  return ranked.map((item) => item.card);
}
