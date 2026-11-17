import {
  CARD_RARITY_CODE_MAX,
  CARD_RARITY_VALUES,
  CARD_SERIES_LIST_PAGE_MAX,
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
  /** CH-239: official rarity code, exact and case-sensitive. */
  rarityCode: string | null;
  sort: CardSeriesListSort;
  page: number;
  /** `parallels=1` only. Any other value is removed from the URL. */
  parallels: boolean;
};

const NUMERIC_ATTRIBUTE_KEYS = ['cost', 'attack', 'health'];

function isRarity(value: string): value is CardRarity {
  return CARD_RARITY_VALUES.some((item) => item === value);
}

function isSort(value: string): value is CardSeriesListSort {
  return CARD_SERIES_LIST_SORT_VALUES.some((item) => item === value);
}

/** Digits only. Values above the API max stay on that max so the list request is accepted. */
function pageWithinLimit(raw: string): number {
  const maxDigits = String(CARD_SERIES_LIST_PAGE_MAX).length;
  if (raw.length > maxDigits) return CARD_SERIES_LIST_PAGE_MAX;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > CARD_SERIES_LIST_PAGE_MAX) {
    return CARD_SERIES_LIST_PAGE_MAX;
  }
  return parsed;
}

/**
 * `rarityCodes` is the series' full code list (Spec CH-239 §2), or null while
 * the list has not answered yet. Codes that are only on parallels stay valid
 * here; whether they are offered is the page's call (§3).
 */
export function parseSeriesListParams(
  search: URLSearchParams,
  subsetSlugs: ReadonlySet<string> | null,
  rarityCodes: readonly string[] | null = null,
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
    if (subsetSlugs === null) subset = rawSubset;
    else if (subsetSlugs.has(rawSubset)) subset = rawSubset;
    else next.delete('subset');
  }

  const hasOfficialCodes = rarityCodes !== null && rarityCodes.length > 0;
  const rawRarity = next.get('rarity');
  let rarity: CardRarity | null = null;
  if (rawRarity !== null) {
    // §1: with official codes the 4-tier filter is not rendered or sent.
    if (isRarity(rawRarity) && !hasOfficialCodes) rarity = rawRarity;
    else next.delete('rarity');
  }

  const rawRarityCode = next.get('rarityCode');
  let rarityCode: string | null = null;
  if (rawRarityCode !== null) {
    const trimmed = rawRarityCode.trim();
    const length = [...trimmed].length;
    const wellFormed = length > 0 && length <= CARD_RARITY_CODE_MAX;
    // §2: malformed goes at once; an unknown code goes once the full list is in.
    if (!wellFormed || (rarityCodes !== null && !rarityCodes.includes(trimmed))) {
      next.delete('rarityCode');
    } else {
      rarityCode = trimmed;
      if (rawRarityCode !== trimmed) next.set('rarityCode', trimmed);
    }
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
      const parsed = pageWithinLimit(rawPage);
      if (parsed === 1) next.delete('page');
      else {
        page = parsed;
        if (String(parsed) !== rawPage) next.set('page', String(parsed));
      }
    }
  }

  const rawParallels = next.get('parallels');
  let parallels = false;
  if (rawParallels !== null) {
    if (rawParallels === '1') parallels = true;
    else next.delete('parallels');
  }

  const cleaned = next.toString();
  return {
    state: { q, subset, rarity, rarityCode, sort, page, parallels },
    search: cleaned,
    replace: cleaned !== original,
  };
}

export function seriesListSearch(state: SeriesListState, current?: URLSearchParams): string {
  const next = new URLSearchParams(current);
  next.delete('q');
  next.delete('subset');
  next.delete('rarity');
  next.delete('rarityCode');
  next.delete('sort');
  next.delete('page');
  next.delete('parallels');
  if (state.q) next.set('q', state.q);
  if (state.subset) next.set('subset', state.subset);
  if (state.rarity) next.set('rarity', state.rarity);
  if (state.rarityCode) next.set('rarityCode', state.rarityCode);
  if (state.sort !== 'number') next.set('sort', state.sort);
  if (state.page > 1) next.set('page', String(state.page));
  if (state.parallels) next.set('parallels', '1');
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
