import { CARD_SERIES_LIST_PAGE_SIZE_MAX } from './zod';

/** Page size used when stitching a full series card list (the API max). */
export const SERIES_DETAIL_CARD_LIST_PAGE_SIZE = CARD_SERIES_LIST_PAGE_SIZE_MAX;

/** Keep a few later pages in flight without opening one request per page. */
const SERIES_DETAIL_CARD_LIST_FETCH_CONCURRENCY = 3;

export type SeriesDetailCardListInput = {
  seriesSlug: string;
  includeParallels: true;
  sort: 'created';
  page: number;
  pageSize: typeof SERIES_DETAIL_CARD_LIST_PAGE_SIZE;
};

export function seriesDetailCardListInput(
  seriesSlug: string,
  page: number,
): SeriesDetailCardListInput {
  return {
    seriesSlug,
    includeParallels: true,
    sort: 'created',
    page,
    pageSize: SERIES_DETAIL_CARD_LIST_PAGE_SIZE,
  };
}

export function seriesDetailCardListPageCount(total: number, pageSize: number): number {
  const size = pageSize > 0 ? pageSize : SERIES_DETAIL_CARD_LIST_PAGE_SIZE;
  if (total <= 0) return 0;
  return Math.ceil(total / size);
}

/** Page numbers after the first, in order, based on the first page's total. */
export function remainingSeriesDetailCardListPages(total: number, pageSize: number): number[] {
  const count = seriesDetailCardListPageCount(total, pageSize);
  if (count <= 1) return [];
  return Array.from({ length: count - 1 }, (_, index) => index + 2);
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      const item = items[index];
      cursor += 1;
      if (item === undefined) return;
      results[index] = await mapper(item, index);
    }
  };
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * Fetch pages 2..N of a series card list and concatenate their items in page
 * order. The first page is supplied by the caller so React Query can own it.
 */
export async function fetchRemainingSeriesDetailCardPages<TItem>(
  fetchPage: (input: SeriesDetailCardListInput) => Promise<{ items: readonly TItem[] }>,
  seriesSlug: string,
  total: number,
  pageSize: number,
): Promise<TItem[]> {
  const pages = remainingSeriesDetailCardListPages(total, pageSize);
  if (pages.length === 0) return [];
  const results = await mapPool(pages, SERIES_DETAIL_CARD_LIST_FETCH_CONCURRENCY, (page) =>
    fetchPage(seriesDetailCardListInput(seriesSlug, page)),
  );
  return results.flatMap((page) => [...page.items]);
}

/** Fetch every page of a series card list and stitch the items in page order. */
export async function collectSeriesDetailCardPages<TItem>(
  fetchPage: (
    input: SeriesDetailCardListInput,
  ) => Promise<{ items: readonly TItem[]; total: number; pageSize: number }>,
  seriesSlug: string,
): Promise<{ items: TItem[]; total: number }> {
  const first = await fetchPage(seriesDetailCardListInput(seriesSlug, 1));
  const rest = await fetchRemainingSeriesDetailCardPages(
    fetchPage,
    seriesSlug,
    first.total,
    first.pageSize,
  );
  return { items: first.items.concat(rest), total: first.total };
}
