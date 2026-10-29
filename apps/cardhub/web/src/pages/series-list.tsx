import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import { t } from '@repo/shared';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui-web';
import { Artwork } from '../components/artwork';
import { Breadcrumbs } from '../components/breadcrumbs';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { PageMeta } from '../components/page-meta';
import { PageShell } from '../components/page-shell';
import { queryFallback, useFocusOnRecovery } from '../components/retry-button';
import { formatCatalogDate } from '../lib/catalog-taxonomy';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

const ANY = 'any';

function yearParam(value: string) {
  return /^\d{4}$/.test(value) ? Number(value) : undefined;
}

export const SeriesListPage = observer(function SeriesListPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [searchParams, setSearchParams] = useSearchParams();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const categoryParam = searchParams.get('category') ?? '';
  const rawYear = searchParams.get('year') ?? '';
  const categoriesQuery = trpc.categories.list.useQuery();
  const knownCategory =
    categoriesQuery.data?.items.some((category) => category.slug === categoryParam) ?? false;
  const requestedYear = yearParam(rawYear);
  const seriesQuery = trpc.series.list.useQuery(
    {
      page: 1,
      pageSize: 100,
      sort: 'releaseDateDesc',
      ...(knownCategory ? { categorySlug: categoryParam } : {}),
      ...(requestedYear ? { year: requestedYear } : {}),
    },
    { placeholderData: keepPreviousData },
  );
  const years = seriesQuery.data?.years ?? [];
  const view = queryFallback(categoriesQuery, seriesQuery);
  useFocusOnRecovery(view === 'error' && !seriesQuery.data ? 'error' : view, headingRef);

  useEffect(() => {
    if (!categoriesQuery.data) return;
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (categoryParam && !categoriesQuery.data.items.some((item) => item.slug === categoryParam)) {
      next.delete('category');
      changed = true;
    }
    if (rawYear && !yearParam(rawYear)) {
      next.delete('year');
      changed = true;
    } else if (
      requestedYear &&
      seriesQuery.data &&
      !seriesQuery.isFetching &&
      !seriesQuery.data.years.includes(requestedYear)
    ) {
      next.delete('year');
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [
    categoriesQuery.data,
    categoryParam,
    rawYear,
    requestedYear,
    searchParams,
    seriesQuery.data,
    seriesQuery.isFetching,
    setSearchParams,
  ]);

  const replaceFilter = (key: 'category' | 'year', value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === ANY) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const filtered = Boolean(categoryParam || rawYear);
  const showSkeleton = view === 'loading' && !seriesQuery.data;
  const showError = (categoriesQuery.isError || seriesQuery.isError) && !seriesQuery.data;

  return (
    <PageShell>
      <PageMeta title={tt('series.list.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('breadcrumb.series') }]}
        />
        <header className="space-y-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-bold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {tt('series.list.title')}
          </h1>
          <p className="text-neutral-600">{tt('series.list.subtitle')}</p>
        </header>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:w-48">
            <label htmlFor="series-category" className="text-sm font-medium text-neutral-800">
              {tt('series.filter.category')}
            </label>
            <Select
              value={knownCategory ? categoryParam : ANY}
              onValueChange={(value) => replaceFilter('category', value)}
            >
              <SelectTrigger id="series-category" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{tt('series.filter.categoryAll')}</SelectItem>
                {(categoriesQuery.data?.items ?? []).map((category) => (
                  <SelectItem key={category.slug} value={category.slug}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-32">
            <label htmlFor="series-year" className="text-sm font-medium text-neutral-800">
              {tt('series.filter.year')}
            </label>
            <Select
              value={requestedYear && years.includes(requestedYear) ? String(requestedYear) : ANY}
              onValueChange={(value) => replaceFilter('year', value)}
            >
              <SelectTrigger id="series-year" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{tt('series.filter.yearAll')}</SelectItem>
                {years.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {String(year)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {showSkeleton ? (
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <li
                key={index}
                className="h-56 animate-pulse motion-reduce:animate-none rounded-2xl border border-white/60 bg-white/50"
              />
            ))}
          </ul>
        ) : showError ? (
          <ErrorBox
            title={tt('state.error')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={categoriesQuery.isFetching || seriesQuery.isFetching}
            retry={() => {
              void categoriesQuery.refetch();
              void seriesQuery.refetch();
            }}
            retryClassName={dataErrorRetryClassName}
            retryRef={retryRef}
          />
        ) : seriesQuery.data && seriesQuery.data.items.length > 0 ? (
          <div aria-busy={seriesQuery.isFetching || undefined} className="space-y-4">
            <p role="status" className="text-sm text-neutral-600">
              {tt('series.total', { count: seriesQuery.data.total })}
            </p>
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {seriesQuery.data.items.map((series) => (
                <li key={series.slug}>
                  <Link
                    to={`/series/${series.slug}`}
                    className="group block overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-sm backdrop-blur transition-transform hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <div className="relative" aria-hidden>
                      <Artwork
                        kind="series"
                        src={series.coverUrl}
                        slug={series.slug}
                        name={series.title}
                        decorative
                        className="w-full"
                      />
                      <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
                    </div>
                    <div className="space-y-2 p-5">
                      <h2 className="text-lg font-semibold text-neutral-900">{series.title}</h2>
                      {series.description ? (
                        <p className="line-clamp-2 text-sm text-neutral-600">
                          {series.description}
                        </p>
                      ) : null}
                      <p className="text-xs text-neutral-600">
                        {tt('series.cardCount', { count: series.cardCount })}
                      </p>
                      {series.releaseDate ? (
                        <p className="text-xs text-neutral-600">
                          <time dateTime={series.releaseDate}>
                            {tt('series.releaseDate', {
                              date: formatCatalogDate(locale.locale, series.releaseDate),
                            })}
                          </time>
                        </p>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div
            aria-busy={seriesQuery.isFetching || undefined}
            className="space-y-4 rounded-lg border border-dashed border-neutral-300 p-8 text-center"
          >
            {filtered && seriesQuery.data ? (
              <p role="status" className="text-sm text-neutral-600">
                {tt('series.total', { count: seriesQuery.data.total })}
              </p>
            ) : null}
            <p className="text-neutral-600">
              {filtered ? tt('series.filterEmpty') : tt('series.empty')}
            </p>
            {filtered ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearchParams({}, { replace: true });
                  headingRef.current?.focus();
                }}
              >
                {tt('series.filterClear')}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </PageShell>
  );
});
