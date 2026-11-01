import {
  CARD_RARITY_VALUES,
  CARD_SERIES_LIST_QUERY_MAX,
  CARD_SERIES_LIST_SORT_VALUES,
  cardAttributeLabel,
  type CardRarity,
  type CardSeriesListSort,
  type Locale,
} from '@repo/shared';

export const SERIES_LIST_PAGE_SIZE = 60;
/** Select value for “all”. Underscores cannot appear in a catalog slug. */
export const SERIES_LIST_ANY = '__all__';

export type SeriesListState = {
  q: string;
  subset: string | null;
  rarity: CardRarity | null;
  sort: CardSeriesListSort;
  page: number;
};

const NUMERIC_ATTRIBUTE_KEYS = ['cost', 'attack', 'health'];

function isRarity(value: string): value is CardRarity {
  return CARD_RARITY_VALUES.some((item) => item === value);
}

function isSort(value: string): value is CardSeriesListSort {
  return CARD_SERIES_LIST_SORT_VALUES.some((item) => item === value);
}

export function parseSeriesListParams(
  search: URLSearchParams,
  subsetSlugs: ReadonlySet<string>,
): { state: SeriesListState; search: string; replace: boolean } {
  const next = new URLSearchParams(search);
  const original = next.toString();

  const rawQ = next.get('q');
  let q = '';
  if (rawQ !== null) {
    q = rawQ.trim().slice(0, CARD_SERIES_LIST_QUERY_MAX);
    if (q.length === 0) next.delete('q');
    else if (rawQ !== q) next.set('q', q);
  }

  const rawSubset = next.get('subset');
  let subset: string | null = null;
  if (rawSubset !== null) {
    if (subsetSlugs.has(rawSubset)) subset = rawSubset;
    else next.delete('subset');
  }

  const rawRarity = next.get('rarity');
  let rarity: CardRarity | null = null;
  if (rawRarity !== null) {
    if (isRarity(rawRarity)) rarity = rawRarity;
    else next.delete('rarity');
  }

  let sort: CardSeriesListSort = 'number';
  const rawSort = next.get('sort');
  if (rawSort !== null) {
    if (!isSort(rawSort) || rawSort === 'number') next.delete('sort');
    if (isSort(rawSort)) sort = rawSort;
  }

  let page = 1;
  const rawPage = next.get('page');
  if (rawPage !== null) {
    if (!/^[1-9][0-9]*$/.test(rawPage)) {
      next.delete('page');
    } else {
      const parsed = Number(rawPage);
      if (parsed === 1) next.delete('page');
      else page = parsed;
    }
  }

  const cleaned = next.toString();
  return {
    state: { q, subset, rarity, sort, page },
    search: cleaned,
    replace: cleaned !== original,
  };
}

export function seriesListSearch(state: SeriesListState, current?: URLSearchParams): string {
  const next = new URLSearchParams(current);
  next.delete('q');
  next.delete('subset');
  next.delete('rarity');
  next.delete('sort');
  next.delete('page');
  if (state.q) next.set('q', state.q);
  if (state.subset) next.set('subset', state.subset);
  if (state.rarity) next.set('rarity', state.rarity);
  if (state.sort !== 'number') next.set('sort', state.sort);
  if (state.page > 1) next.set('page', String(state.page));
  return next.toString();
}

export type PageToken = { kind: 'page'; page: number } | { kind: 'gap'; key: string };

/** 1, last, and the current page ± 1. Gaps are ellipses. */
export function pageTokens(current: number, last: number): PageToken[] {
  const wanted = [1, last, current - 1, current, current + 1].filter(
    (page) => page >= 1 && page <= last,
  );
  const unique = [...new Set(wanted)].sort((left, right) => left - right);
  const tokens: PageToken[] = [];
  let previous = 0;
  for (const page of unique) {
    if (previous > 0 && page - previous > 1) {
      tokens.push({ kind: 'gap', key: `gap-${previous}` });
    }
    tokens.push({ kind: 'page', page });
    previous = page;
  }
  return tokens;
}

type AttributeValue = string | number | boolean | null;

export function seriesCardAttributeLine(
  attributes: Record<string, AttributeValue> | null | undefined,
  labels: Record<string, Record<Locale, string>> | undefined,
  locale: Locale,
): string | null {
  if (!attributes) return null;
  const parts: string[] = [];
  for (const key of NUMERIC_ATTRIBUTE_KEYS) {
    const value = attributes[key];
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    if (typeof value === 'string' && value.trim().length === 0) continue;
    const label = labels?.[key]?.[locale] ?? cardAttributeLabel(locale, key);
    parts.push(`${label} ${value}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
