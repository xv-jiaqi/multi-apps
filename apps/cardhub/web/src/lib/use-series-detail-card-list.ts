import { useEffect, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@repo/trpc-contract';
import {
  fetchRemainingSeriesDetailCardPages,
  seriesDetailCardListInput,
  seriesDetailCardListPageCount,
} from '@repo/shared';
import { trpc } from './trpc';

type ListBySeriesResult = inferRouterOutputs<AppRouter>['cards']['listBySeries'];
export type SeriesDetailCard = ListBySeriesResult['items'][number];

type AssembledCards = {
  slug: string;
  items: SeriesDetailCard[];
  total: number;
};

/**
 * Loads every card in a series via `cards.listBySeries` (pageSize 100,
 * parallels included, created order) and stitches the pages. The table stays
 * on the existing skeleton until the full list is ready; a later-page failure
 * is an error, not a partial table.
 */
export function useSeriesDetailCardList(seriesSlug: string) {
  const utils = trpc.useUtils();
  const firstPage = trpc.cards.listBySeries.useQuery(seriesDetailCardListInput(seriesSlug, 1), {
    enabled: Boolean(seriesSlug),
  });
  const fetchLaterPages = useRef(utils.cards.listBySeries.fetch);
  fetchLaterPages.current = utils.cards.listBySeries.fetch;
  const [extraStatus, setExtraStatus] = useState<{
    slug: string;
    status: 'idle' | 'loading' | 'ready' | 'error';
  }>({ slug: '', status: 'idle' });
  const [assembled, setAssembled] = useState<AssembledCards | null>(null);
  const [retry, setRetry] = useState(0);

  const pageCount =
    firstPage.data == null
      ? 0
      : seriesDetailCardListPageCount(firstPage.data.total, firstPage.data.pageSize);
  const status = extraStatus.slug === seriesSlug ? extraStatus.status : 'idle';

  useEffect(() => {
    if (!seriesSlug || firstPage.data == null) return;
    const first = firstPage.data;
    const count = seriesDetailCardListPageCount(first.total, first.pageSize);
    if (count <= 1) {
      setExtraStatus({ slug: seriesSlug, status: 'idle' });
      setAssembled({ slug: seriesSlug, items: first.items, total: first.total });
      return;
    }
    let cancelled = false;
    setExtraStatus({ slug: seriesSlug, status: 'loading' });
    void (async () => {
      try {
        const rest = await fetchRemainingSeriesDetailCardPages(
          (input) => fetchLaterPages.current(input),
          seriesSlug,
          first.total,
          first.pageSize,
        );
        if (!cancelled) {
          setAssembled({
            slug: seriesSlug,
            items: first.items.concat(rest),
            total: first.total,
          });
          setExtraStatus({ slug: seriesSlug, status: 'ready' });
        }
      } catch {
        if (!cancelled) setExtraStatus({ slug: seriesSlug, status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seriesSlug, firstPage.data, firstPage.dataUpdatedAt, retry]);

  const derived: AssembledCards | null =
    firstPage.data != null && pageCount <= 1
      ? { slug: seriesSlug, items: firstPage.data.items, total: firstPage.data.total }
      : assembled?.slug === seriesSlug
        ? assembled
        : null;
  const hasData = derived !== null;
  const waitingInitialExtra =
    firstPage.data != null && pageCount > 1 && !hasData && status !== 'error';
  const isError = firstPage.isError || status === 'error';
  const isLoading = firstPage.isLoading || waitingInitialExtra;

  return {
    items: derived?.items ?? [],
    total: derived?.total,
    query: {
      data: derived ?? undefined,
      isError,
      isLoading,
      isPending: firstPage.isPending || waitingInitialExtra,
      isFetching: firstPage.isFetching || status === 'loading' || waitingInitialExtra,
      errorUpdateCount: firstPage.errorUpdateCount + (status === 'error' ? 1 : 0),
      dataUpdatedAt: firstPage.dataUpdatedAt,
      error: firstPage.error,
      refetch: () => {
        setRetry((count) => count + 1);
        return firstPage.refetch();
      },
    },
  };
}
