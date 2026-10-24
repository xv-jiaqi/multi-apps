import { observer } from 'mobx-react-lite';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { Search } from 'lucide-react';
import type { AppRouter } from '@repo/trpc-contract';
import {
  CARD_RARITY_VALUES,
  parseCardSearchQuery,
  shouldRequestCardSearchQuery,
  t,
  type CardRarity,
} from '@repo/shared';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui-web';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { RARITY_LABELS, RarityBadge } from '../components/rarity-badge';
import { CardThumb } from '../components/card-thumb';
import { SeriesMark } from '../components/series-mark';
import { SyntaxExamples, UnsupportedHint } from '../components/search-syntax';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { useDebounced } from '../lib/use-debounced';
import {
  clearRarityAndSeries,
  firstPrefixedValue,
  hasRarityOrSeriesFilter,
  replacePrefixedValue,
  selectedRarity,
} from '../lib/search-query';

const SEARCH_DEBOUNCE_MS = 250;
type GlobalSearchResult = inferRouterOutputs<AppRouter>['search']['global'];
const RESULT_LIST_CLASS =
  'divide-y divide-neutral-200/60 overflow-hidden rounded-2xl border border-white/60 bg-white/70 backdrop-blur';
const RESULT_LINK_CLASS =
  'flex items-center gap-4 p-4 hover:bg-neutral-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500';

function knownRarity(rarity: string | null): CardRarity | null {
  if (rarity && (CARD_RARITY_VALUES as readonly string[]).includes(rarity)) {
    return rarity as CardRarity;
  }
  return null;
}

function Field({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
      </label>
      {children}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <ul className={`${RESULT_LIST_CLASS} animate-pulse motion-reduce:animate-none`}>
      {Array.from({ length: 3 }, (_, index) => (
        <li key={index} className="flex items-center gap-4 p-4">
          <span className="aspect-[63/88] w-10 shrink-0 rounded-sm bg-neutral-200" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-4 w-40 rounded-sm bg-neutral-200" />
            <span className="block h-3 w-24 rounded-sm bg-neutral-200" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export const SearchPage = observer(function SearchPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  const [trackedUrl, setTrackedUrl] = useState(urlQuery);
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const urlQueryRef = useRef(urlQuery);
  const setSearchParamsRef = useRef(setSearchParams);
  const writtenQuery = useRef<string | null>(null);
  urlQueryRef.current = urlQuery;
  setSearchParamsRef.current = setSearchParams;
  const rarityId = useId();
  const seriesId = useId();

  // The address bar is the source of truth. Adopt a new ?q= during render so
  // the input and the request both use it before paint. Typing still debounces
  // into the URL, and that write must not be adopted back over the input.
  const urlChanged = urlQuery !== trackedUrl;
  const adoptingUrl = urlChanged && writtenQuery.current !== urlQuery;
  if (urlChanged) {
    setTrackedUrl(urlQuery);
    if (adoptingUrl) setQuery(urlQuery);
  }
  const visibleQuery = adoptingUrl ? urlQuery : query;

  useEffect(() => {
    if (writtenQuery.current === urlQuery) writtenQuery.current = null;
  }, [urlQuery]);

  useEffect(() => {
    const next = debounced.trim();
    if (next === urlQueryRef.current) return;
    writtenQuery.current = next;
    setSearchParamsRef.current(next ? { q: next } : {}, { replace: true });
  }, [debounced]);

  const requested = (visibleQuery.trim() === urlQuery ? visibleQuery : debounced).trim();
  const liveParsed = parseCardSearchQuery(visibleQuery);
  const liveCanRequest = shouldRequestCardSearchQuery(visibleQuery);
  const canRequest = shouldRequestCardSearchQuery(requested);
  const results = trpc.search.global.useQuery(
    { q: requested, limit: 30 },
    { enabled: canRequest, placeholderData: keepPreviousData },
  );
  const seriesList = trpc.series.list.useQuery({ pageSize: 100 });

  const seriesOptions = useMemo(() => {
    const items = seriesList.data?.items ?? [];
    return [...items].sort((left, right) => left.title.localeCompare(right.title, locale.locale));
  }, [locale.locale, seriesList.data]);

  const rarityValue = selectedRarity(visibleQuery);
  const seriesSlug = firstPrefixedValue(visibleQuery, 's');
  const seriesValue =
    seriesSlug && seriesOptions.some((item) => item.slug === seriesSlug) ? seriesSlug : 'any';
  const hasFilters = hasRarityOrSeriesFilter(visibleQuery);
  const titleQuery = visibleQuery.trim();

  const clearFilters = () => setQuery(clearRarityAndSeries(visibleQuery));

  const cardTotal = results.data?.cards.length ?? 0;
  const seriesTotal = results.data?.series.length ?? 0;
  const statusText =
    canRequest && results.isFetching
      ? tt('form.searching')
      : canRequest && results.isSuccess && !results.isFetching
        ? tt('search.resultsSummary', {
            cards: tt('search.summary.cards', { count: cardTotal }),
            series: tt('search.summary.series', { count: seriesTotal }),
            results: tt('form.resultsCount', { count: cardTotal + seriesTotal }),
          })
        : '';

  return (
    <PageShell>
      <PageMeta
        title={titleQuery ? tt('search.results.title', { query: titleQuery }) : tt('nav.search')}
      />
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('nav.search') }]}
        />

        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">{tt('nav.search')}</h1>
          <div className="relative max-w-xl">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500"
              aria-hidden
            />
            <Input
              type="search"
              value={visibleQuery}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={tt('search.headerLabel')}
              aria-describedby={liveParsed.ok ? 'search-syntax' : 'search-syntax search-hint'}
              placeholder={tt('search.placeholder')}
              className="pl-9"
            />
          </div>
          <SyntaxExamples id="search-syntax" onExample={setQuery} />
          {!liveParsed.ok ? <UnsupportedHint id="search-hint" error={liveParsed} /> : null}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field id={rarityId} label={tt('search.filterRarity')} className="w-full sm:w-40">
            <Select
              value={rarityValue}
              onValueChange={(value) =>
                setQuery(replacePrefixedValue(visibleQuery, 'r', value === 'any' ? null : value))
              }
            >
              <SelectTrigger id={rarityId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="any">{tt('search.filterAny')}</SelectItem>
                  {CARD_RARITY_VALUES.map((rarity) => (
                    <SelectItem key={rarity} value={rarity}>
                      {RARITY_LABELS[rarity][locale.locale]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field id={seriesId} label={tt('search.filterSeries')} className="w-full sm:w-56">
            <Select
              value={seriesValue}
              disabled={seriesList.isLoading}
              onValueChange={(value) =>
                setQuery(replacePrefixedValue(visibleQuery, 's', value === 'any' ? null : value))
              }
            >
              <SelectTrigger id={seriesId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="any">{tt('search.filterAny')}</SelectItem>
                  {seriesOptions.map((item) => (
                    <SelectItem key={item.slug} value={item.slug}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {hasFilters ? (
            <Button type="button" variant="link" size="sm" onClick={clearFilters}>
              {tt('search.clearFilters')}
            </Button>
          ) : null}
        </div>

        <p role="status" className="sr-only">
          {statusText}
        </p>

        <SearchResults
          query={visibleQuery}
          liveCanRequest={liveCanRequest}
          parsedOk={liveParsed.ok}
          canRequest={canRequest}
          hasFilters={hasFilters}
          isLoading={results.isLoading}
          isError={results.isError}
          data={results.data}
          onRetry={() => {
            void results.refetch();
          }}
          retryPending={results.isFetching}
          onClearFilters={clearFilters}
          locale={locale.locale}
          tt={tt}
        />
      </div>
    </PageShell>
  );
});

function SearchResults({
  query,
  liveCanRequest,
  parsedOk,
  canRequest,
  hasFilters,
  isLoading,
  isError,
  data,
  onRetry,
  retryPending,
  onClearFilters,
  locale,
  tt,
}: {
  query: string;
  liveCanRequest: boolean;
  parsedOk: boolean;
  canRequest: boolean;
  hasFilters: boolean;
  isLoading: boolean;
  isError: boolean;
  data: GlobalSearchResult | undefined;
  onRetry: () => void;
  retryPending: boolean;
  onClearFilters: () => void;
  locale: 'zh-CN' | 'en-US';
  tt: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (!query.trim()) {
    return <p className="text-sm text-neutral-600">{tt('search.prompt')}</p>;
  }

  if (!parsedOk) {
    if (!data) return null;
    return (
      <div className="opacity-60">
        <ResultLists
          data={data}
          locale={locale}
          tt={tt}
          hasFilters={hasFilters}
          onClearFilters={onClearFilters}
        />
      </div>
    );
  }

  if (!liveCanRequest) {
    return <p className="text-sm text-neutral-600">{tt('search.prompt')}</p>;
  }

  if (canRequest && isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <p className="font-medium">{tt('form.searchFailed')}</p>
        <button
          type="button"
          onClick={onRetry}
          disabled={retryPending}
          className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:pointer-events-none disabled:opacity-50"
        >
          {tt('state.retry')}
        </button>
      </div>
    );
  }

  if (!data || isLoading) return <SearchSkeleton />;

  return (
    <ResultLists
      data={data}
      locale={locale}
      tt={tt}
      hasFilters={hasFilters}
      onClearFilters={onClearFilters}
    />
  );
}

function ResultLists({
  data,
  locale,
  tt,
  hasFilters,
  onClearFilters,
}: {
  data: GlobalSearchResult | undefined;
  locale: 'zh-CN' | 'en-US';
  tt: (key: string, vars?: Record<string, string | number>) => string;
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  const cards = data?.cards ?? [];
  const series = data?.series ?? [];
  if (cards.length === 0 && series.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-600">
        <p>{tt('search.empty')}</p>
        {hasFilters ? (
          <Button type="button" variant="outline" className="mt-4" onClick={onClearFilters}>
            {tt('search.clearFilters')}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {series.length > 0 ? (
        <section aria-labelledby="sr-series" className="space-y-3">
          <h2 id="sr-series" className="text-lg font-semibold">
            {tt('search.seriesHeading', { count: series.length })}
          </h2>
          <ul className={RESULT_LIST_CLASS}>
            {series.map((item) => (
              <li key={item.slug}>
                <Link to={`/series/${item.slug}`} className={RESULT_LINK_CLASS}>
                  <SeriesMark slug={item.slug} coverUrl={item.coverUrl} size="size-10" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-900">
                      {item.title}
                    </span>
                    <span className="block truncate text-xs text-neutral-600">
                      {tt('series.cardCount', { count: item.cardCount })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {cards.length > 0 ? (
        <section aria-labelledby="sr-cards" className="space-y-3">
          <h2 id="sr-cards" className="text-lg font-semibold">
            {tt('search.cardsHeading', { count: cards.length })}
          </h2>
          <ul className={RESULT_LIST_CLASS}>
            {cards.map((card) => {
              const rarity = knownRarity(card.rarity);
              return (
                <li key={card.slug}>
                  <Link to={`/cards/${card.slug}`} className={RESULT_LINK_CLASS}>
                    <CardThumb src={card.imageUrl} slug={card.slug} width="w-10" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-neutral-900">
                        {card.name}
                      </span>
                      <span className="block truncate text-xs text-neutral-600">
                        {card.seriesTitle}
                      </span>
                    </span>
                    {rarity ? <RarityBadge rarity={rarity} locale={locale} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
