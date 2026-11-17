import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { trpc } from '../lib/trpc';
import { seriesCardListInput, seriesDetailInput } from '../lib/series-detail-queries';
import { parseSeriesListParams } from '../lib/series-list-params';

/**
 * CH-240: starts the series page's two queries from the main bundle, so they
 * run while the lazy series-detail chunk downloads instead of after it mounts.
 * Subsets are unknown here, the same as on the page's first render.
 */
export function SeriesDetailPrefetch() {
  const { seriesSlug = '' } = useParams<{ seriesSlug: string }>();
  const [searchParams] = useSearchParams();
  const searchRef = useRef(searchParams);
  searchRef.current = searchParams;
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!seriesSlug) return;
    const { state } = parseSeriesListParams(searchRef.current, null);
    void utils.series.bySlug.prefetch(seriesDetailInput(seriesSlug));
    void utils.cards.listBySeries.prefetch(seriesCardListInput(seriesSlug, state));
  }, [seriesSlug, utils]);

  return null;
}
