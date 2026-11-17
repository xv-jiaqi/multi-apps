import { SERIES_LIST_PAGE_SIZE, type SeriesListState } from './series-list-params';

/**
 * Query inputs for the series page. The page and the route-level prefetch
 * build them here so both hit the same React Query cache entry.
 */
export function seriesDetailInput(seriesSlug: string) {
  return { slug: seriesSlug, includeCards: false };
}

export function seriesCardListInput(seriesSlug: string, state: SeriesListState) {
  return {
    seriesSlug,
    page: state.page,
    pageSize: SERIES_LIST_PAGE_SIZE,
    ...(state.q ? { q: state.q } : {}),
    ...(state.subset ? { subsetSlug: state.subset } : {}),
    ...(state.rarity ? { rarity: state.rarity } : {}),
    ...(state.rarityCode ? { rarityCode: state.rarityCode } : {}),
    ...(state.sort !== 'number' ? { sort: state.sort } : {}),
    ...(state.parallels ? { includeParallels: true } : {}),
  };
}
