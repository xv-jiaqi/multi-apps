export interface TaxonomyCard {
  slug: string;
  name: string;
  cardNumber?: string | null;
  subsetSlug?: string | null;
}

export interface TaxonomySubset {
  slug: string;
  name: string;
  kind: 'BASE' | 'INSERT';
  sortOrder: number;
}

export interface CardGroup<TCard extends TaxonomyCard> {
  id: string;
  name: string;
  kind: 'BASE' | 'INSERT' | 'UNGROUPED';
  cards: TCard[];
}

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** String order. Blank numbers go last, then name, then slug. */
export function sortTaxonomyCards<TCard extends TaxonomyCard>(cards: TCard[]): TCard[] {
  return [...cards].sort((left, right) => {
    const leftNumber = left.cardNumber?.trim() ?? '';
    const rightNumber = right.cardNumber?.trim() ?? '';
    if (!leftNumber !== !rightNumber) return leftNumber ? -1 : 1;
    if (leftNumber && rightNumber) {
      const byNumber = compareText(leftNumber, rightNumber);
      if (byNumber !== 0) return byNumber;
    }
    const byName = compareText(left.name, right.name);
    if (byName !== 0) return byName;
    return compareText(left.slug, right.slug);
  });
}

/**
 * No subsets: one flat list and no group headings.
 * Otherwise each non-empty subset is a group, and cards with no subset come last.
 */
export function groupSeriesCards<TCard extends TaxonomyCard>(
  subsets: TaxonomySubset[] | undefined,
  cards: TCard[],
): { flat: boolean; groups: CardGroup<TCard>[] } {
  const defined = subsets ?? [];
  if (defined.length === 0) {
    return { flat: true, groups: [] };
  }
  const known = new Set(defined.map((subset) => subset.slug));
  const groups: CardGroup<TCard>[] = [...defined]
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        compareText(left.name, right.name) ||
        compareText(left.slug, right.slug),
    )
    .map((subset) => ({
      id: subset.slug,
      name: subset.name,
      kind: subset.kind,
      cards: sortTaxonomyCards(cards.filter((card) => card.subsetSlug === subset.slug)),
    }))
    .filter((group) => group.cards.length > 0);
  const ungrouped = sortTaxonomyCards(
    cards.filter((card) => !card.subsetSlug || !known.has(card.subsetSlug)),
  );
  if (ungrouped.length > 0) {
    groups.push({ id: 'ungrouped', name: '', kind: 'UNGROUPED', cards: ungrouped });
  }
  return { flat: false, groups };
}

export function formatCatalogDate(locale: string, isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(year, month - 1, day),
  );
}

export function displayCardNumber(cardNumber: string) {
  return cardNumber.startsWith('#') ? cardNumber : `#${cardNumber}`;
}
