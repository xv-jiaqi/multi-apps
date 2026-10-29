import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { appErrorMessage, t } from '@repo/shared';
import { Button, Card, CardContent, CardHeader } from '@repo/ui-web';
import { CardThumb } from '../components/card-thumb';
import { ErrorBox, dataErrorRetryClassName } from '../components/error-box';
import {
  queryFallback,
  useFocusOnPersistentError,
  type QueryFallbackState,
} from '../components/retry-button';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';
import { SectionSkeleton } from './me-skeleton';

type CollectionFilter = 'all' | 'owned' | 'wanted';

type ProgressItem = {
  seriesSlug: string;
  seriesTitle: string;
  owned: number;
  total: number;
};

const FILTERS: Array<{ state: CollectionFilter; labelKey: string }> = [
  { state: 'all', labelKey: 'collection.filterAll' },
  { state: 'owned', labelKey: 'collection.filterOwned' },
  { state: 'wanted', labelKey: 'collection.filterWanted' },
];

const retryClassName = `${dataErrorRetryClassName} h-10 min-h-10 text-sm`;

function readAppCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined;
  const data = error.data;
  if (typeof data !== 'object' || data === null || !('appCode' in data)) return undefined;
  return data.appCode;
}

export function sortCollectionProgress(items: ProgressItem[], locale: string): ProgressItem[] {
  return [...items].sort((left, right) => {
    const leftRatio = left.total > 0 ? left.owned / left.total : 0;
    const rightRatio = right.total > 0 ? right.owned / right.total : 0;
    if (leftRatio !== rightRatio) return rightRatio - leftRatio;
    return left.seriesTitle.localeCompare(right.seriesTitle, locale);
  });
}

function initialView(query: QueryFallbackState, hasData: boolean): 'error' | 'loading' | 'ready' {
  if (hasData) return 'ready';
  return queryFallback(query);
}

export function CollectionSection() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [filter, setFilter] = useState<CollectionFilter>('all');
  const progressRetryRef = useRef<HTMLButtonElement>(null);
  const listRetryRef = useRef<HTMLButtonElement>(null);

  const progress = trpc.collection.progress.useQuery(undefined, {
    enabled: session.isAuthenticated,
    retry: false,
  });
  const list = trpc.collection.list.useInfiniteQuery(
    { limit: 20, state: filter },
    {
      enabled: session.isAuthenticated,
      retry: false,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    },
  );

  const progressItems = useMemo(
    () => sortCollectionProgress(progress.data?.items ?? [], locale.locale),
    [locale.locale, progress.data?.items],
  );
  const listItems = list.data?.pages.flatMap((page) => page.items) ?? [];
  const progressState = initialView(progress, progress.data !== undefined);
  const listState = initialView(list, list.data !== undefined);
  const bothLoading = progressState === 'loading' && listState === 'loading';
  const nothingCollected =
    filter === 'all' &&
    progressState === 'ready' &&
    listState === 'ready' &&
    progressItems.length === 0 &&
    listItems.length === 0;

  const progressError =
    progressState === 'error'
      ? {
          id: progress.errorUpdateCount,
          text: appErrorMessage(locale.locale, readAppCode(progress.error)),
        }
      : null;
  const listError =
    listState === 'error'
      ? { id: list.errorUpdateCount, text: appErrorMessage(locale.locale, readAppCode(list.error)) }
      : null;
  const moreError =
    list.data && list.isError
      ? { id: list.errorUpdateCount, text: appErrorMessage(locale.locale, readAppCode(list.error)) }
      : null;

  useFocusOnPersistentError(Boolean(progressError && progressError.id > 1), progressRetryRef);
  useFocusOnPersistentError(Boolean(listError && listError.id > 1), listRetryRef);
  useFocusOnPersistentError(Boolean(moreError && moreError.id > 1), listRetryRef);

  return (
    <section
      id="me-collection"
      aria-labelledby="me-collection-title"
      aria-busy={bothLoading || undefined}
      className="scroll-mt-20"
    >
      <Card className="border-white/60 bg-white/70 backdrop-blur">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <h2
            id="me-collection-title"
            tabIndex={-1}
            className="text-base font-semibold text-neutral-900 focus:outline-none"
          >
            {tt('collection.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-6">
          {bothLoading ? <SectionSkeleton withThumb /> : null}
          {!bothLoading && nothingCollected ? (
            <>
              <FilterBar filter={filter} onFilter={setFilter} label={tt} />
              <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600">
                {tt('collection.empty')}
              </p>
            </>
          ) : null}
          {!bothLoading && !nothingCollected ? (
            <>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-900">
                  {tt('collection.sectionProgress')}
                </h3>
                {progressError ? (
                  <ErrorBox
                    key={progressError.id}
                    title={progressError.text}
                    retryLabel={tt('collection.retry')}
                    retryingLabel={tt('state.retrying')}
                    retrying={progress.isFetching}
                    retry={() => {
                      void progress.refetch();
                    }}
                    retryRef={progressRetryRef}
                    retryClassName={retryClassName}
                  />
                ) : null}
                {progressState === 'loading' ? <SectionSkeleton /> : null}
                {progressState === 'ready' ? (
                  <ul className="space-y-4">
                    {progressItems.map((item) => (
                      <li key={item.seriesSlug} className="min-w-0">
                        <div className="flex min-w-0 flex-col items-start gap-1 md:flex-row md:items-baseline md:justify-between">
                          <Link
                            to={`/series/${item.seriesSlug}`}
                            className="min-w-0 py-1 text-brand-600 wrap-anywhere hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                          >
                            {item.seriesTitle}
                          </Link>
                          <p className="text-sm text-neutral-600 tabular-nums">
                            {tt('collection.progress', { owned: item.owned, total: item.total })}
                            {item.total > 0 && item.owned === item.total
                              ? ` ${tt('collection.complete')}`
                              : null}
                          </p>
                        </div>
                        {item.total > 0 ? (
                          <div
                            role="progressbar"
                            aria-valuenow={item.owned}
                            aria-valuemin={0}
                            aria-valuemax={item.total}
                            aria-label={item.seriesTitle}
                            className="mt-2 h-2 rounded-full bg-neutral-200"
                          >
                            <div
                              className="h-2 rounded-full bg-brand-600"
                              style={{
                                width: `${Math.min(100, (item.owned / item.total) * 100)}%`,
                              }}
                            />
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-900">
                  {tt('collection.sectionList')}
                </h3>
                <FilterBar filter={filter} onFilter={setFilter} label={tt} />
                {listError ? (
                  <ErrorBox
                    key={listError.id}
                    title={listError.text}
                    retryLabel={tt('collection.retry')}
                    retryingLabel={tt('state.retrying')}
                    retrying={list.isFetching}
                    retry={() => {
                      void list.refetch();
                    }}
                    retryRef={listRetryRef}
                    retryClassName={retryClassName}
                  />
                ) : null}
                {listState === 'loading' ? <SectionSkeleton withThumb /> : null}
                {listState === 'ready' && listItems.length === 0 ? (
                  <p className="text-sm text-neutral-600">{tt('collection.none')}</p>
                ) : null}
                {listState === 'ready' && listItems.length > 0 ? (
                  <ul className="divide-y divide-neutral-200/70">
                    {listItems.map((item) => (
                      <li key={item.id} className="flex min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
                        <CardThumb width="w-10" src={item.imageUrl} slug={item.cardSlug} />
                        <div className="min-w-0 space-y-1">
                          <Link
                            to={`/cards/${item.cardSlug}`}
                            className="inline-block min-w-0 py-1 font-medium text-neutral-900 wrap-anywhere hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                          >
                            {item.cardName}
                          </Link>
                          <p className="min-w-0 text-sm text-neutral-600 wrap-anywhere">
                            {item.seriesTitle}
                          </p>
                          <div className="flex flex-wrap gap-3">
                            {item.ownedCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-sm text-neutral-600">
                                <span aria-hidden="true">✓</span>
                                {item.ownedCount >= 2
                                  ? tt('collection.badgeOwned', { count: item.ownedCount })
                                  : tt('collection.own')}
                              </span>
                            ) : null}
                            {item.wanted ? (
                              <span className="inline-flex items-center gap-1 text-sm text-neutral-600">
                                <span aria-hidden="true">✓</span>
                                {tt('collection.badgeWanted')}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {listState === 'ready' && list.hasNextPage ? (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={list.isFetchingNextPage}
                      aria-busy={list.isFetchingNextPage || undefined}
                      onClick={() => {
                        void list.fetchNextPage();
                      }}
                    >
                      {list.isFetchingNextPage ? tt('state.loading') : tt('me.loadMore')}
                    </Button>
                  </div>
                ) : null}
                {moreError ? (
                  <ErrorBox
                    key={moreError.id}
                    title={moreError.text}
                    retryLabel={tt('collection.retry')}
                    retryingLabel={tt('state.retrying')}
                    retrying={list.isFetchingNextPage}
                    retry={() => {
                      void list.fetchNextPage();
                    }}
                    retryRef={listRetryRef}
                    retryClassName={retryClassName}
                  />
                ) : null}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function FilterBar({
  filter,
  onFilter,
  label,
}: {
  filter: CollectionFilter;
  onFilter: (next: CollectionFilter) => void;
  label: (key: string) => string;
}) {
  return (
    <div
      role="group"
      aria-label={label('collection.filter')}
      className="grid grid-cols-3 gap-2 md:flex md:flex-wrap"
    >
      {FILTERS.map((item) => {
        const pressed = filter === item.state;
        return (
          <Button
            key={item.state}
            type="button"
            variant="outline"
            aria-pressed={pressed}
            className={
              pressed
                ? 'w-full border-brand-600 bg-brand-600 text-white hover:bg-brand-600 hover:text-white md:w-auto'
                : 'w-full md:w-auto'
            }
            onClick={(event) => {
              onFilter(item.state);
              event.currentTarget.focus();
            }}
          >
            {pressed ? <span aria-hidden="true">✓</span> : null}
            {label(item.labelKey)}
          </Button>
        );
      })}
    </div>
  );
}
