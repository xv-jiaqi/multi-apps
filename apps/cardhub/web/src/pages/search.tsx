import { observer } from 'mobx-react-lite';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { Search } from 'lucide-react';
import type { AppRouter } from '@repo/trpc-contract';
import {
  CARD_RARITY_VALUES,
  cardSearchHint,
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
import { CardVariantBadgeRow } from '../components/card-variant-badge';
import { CardThumb } from '../components/card-thumb';
import { CardNumberSubsetLine } from '../components/card-number-subset';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { PagePagination } from '../components/page-pagination';
import { queryFallback, useFocusOnRecovery } from '../components/retry-button';
import { SeriesMark } from '../components/series-mark';
import { SearchParseHint, SyntaxExamples } from '../components/search-syntax';
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
/** CH-241 §1: 30 cards per page, not in the URL. */
export const SEARCH_PAGE_SIZE = 30;
/** Same cap as `search.global` `cardPage` (api search.router.ts SEARCH_CARD_PAGE_MAX). */
const SEARCH_CARD_PAGE_MAX = 10_000;
const PAGE_PARAM = /^[1-9][0-9]*$/;

/**
 * `?page=` → page number. Absent is page 1. Anything that is not a positive
 * integer within the API cap is invalid and gets removed with `replace`.
 */
export function searchPageParam(raw: string | null): { page: number; valid: boolean } {
  if (raw === null) return { page: 1, valid: true };
  if (!PAGE_PARAM.test(raw)) return { page: 1, valid: false };
  const page = Number(raw);
  if (!Number.isSafeInteger(page) || page > SEARCH_CARD_PAGE_MAX) return { page: 1, valid: false };
  return { page, valid: true };
}

/** `/search?q=…&page=n`. Page 1 is not written (CH-241 §1). */
export function searchHref(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search ? `/search?${search}` : '/search';
}

function scrollHeadingIntoView(node: HTMLElement) {
  node.focus({ preventScroll: true });
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}
type GlobalSearchResult = inferRouterOutputs<AppRouter>['search']['global'];
const RESULT_LIST_CLASS =
  'divide-y divide-neutral-200/60 overflow-hidden rounded-2xl border border-card/60 bg-card/70 backdrop-blur';
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

/**
 * CH-241 §6: the 40px title slot (h-7 + space-y-3) sits above the 3 skeleton
 * rows, so the first row does not move when «卡牌（N）» arrives. No number,
 * no pagination while loading.
 */
function SearchSkeleton() {
  return (
    <div className="min-h-svh space-y-3">
      <div
        aria-hidden
        className="h-7 w-32 animate-pulse rounded-sm bg-neutral-200 motion-reduce:animate-none"
      />
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
    </div>
  );
}

export const SearchPage = observer(function SearchPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const rawPage = searchParams.get('page');
  const pageParam = searchPageParam(rawPage);
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
  const liveHint = cardSearchHint(liveParsed) !== null;
  const liveCanRequest = shouldRequestCardSearchQuery(visibleQuery);
  const canRequest = shouldRequestCardSearchQuery(requested);
  // A typed query that has not reached the URL yet starts on page 1.
  const cardPage = requested === urlQuery ? pageParam.page : 1;
  const results = trpc.search.global.useQuery(
    { q: requested, limit: SEARCH_PAGE_SIZE, cardPage },
    { enabled: canRequest, placeholderData: keepPreviousData },
  );
  const resultsView = queryFallback(results);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const pageFocus = useRef(false);
  const retryWasBusy = useRef(false);
  useFocusOnRecovery(resultsView, headingRef);

  // `?page=` that is not a positive integer, or an explicit page 1, is dropped.
  useEffect(() => {
    if (pageParam.valid && rawPage !== '1') return;
    if (rawPage === null) return;
    setSearchParamsRef.current(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [pageParam.valid, rawPage]);

  // Past the last page: replace with the last page (page 1 is not written).
  const freshData =
    results.data && !results.isPlaceholderData && results.data.query === requested
      ? results.data
      : undefined;
  const pageCount = freshData ? Math.max(1, Math.ceil(freshData.cardTotal / SEARCH_PAGE_SIZE)) : 0;
  const lastPageParam = pageCount > 1 ? String(pageCount) : null;
  const pastEnd = freshData !== undefined && requested === urlQuery && cardPage > pageCount;
  useEffect(() => {
    // Compare against the address bar so the write happens once, whatever the
    // identity of `data` on later renders.
    if (!pastEnd || rawPage === lastPageParam) return;
    setSearchParamsRef.current(
      (current) => {
        const next = new URLSearchParams(current);
        if (lastPageParam) next.set('page', lastPageParam);
        else next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [lastPageParam, pastEnd, rawPage]);

  // After a page click, focus «卡牌（N）» once the new page is on screen.
  useLayoutEffect(() => {
    if (!pageFocus.current || results.isFetching || !results.data) return;
    pageFocus.current = false;
    if (headingRef.current) scrollHeadingIntoView(headingRef.current);
  }, [results.data, results.isFetching]);

  // CH-202 §7: a retry that fails again keeps focus on the retry button.
  useLayoutEffect(() => {
    const busy = resultsView === 'error' && results.isFetching;
    const failedRetry = retryWasBusy.current && !busy && resultsView === 'error';
    retryWasBusy.current = busy;
    const active = document.activeElement;
    if (failedRetry && (active === null || active === document.body)) {
      retryRef.current?.focus({ preventScroll: true });
    }
  }, [results.isFetching, resultsView]);
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

  const cardTotal = results.data?.cardTotal ?? 0;
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
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              type="search"
              value={visibleQuery}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={tt('search.headerLabel')}
              aria-describedby={liveHint ? 'search-syntax search-hint' : 'search-syntax'}
              placeholder={tt('search.placeholder')}
              className="pl-9"
            />
          </div>
          <SyntaxExamples id="search-syntax" onExample={setQuery} />
          <SearchParseHint id="search-hint" parsed={liveParsed} />
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
          view={resultsView}
          data={results.data}
          busy={results.isFetching}
          onRetry={() => {
            void results.refetch();
          }}
          retryRef={retryRef}
          onClearFilters={clearFilters}
          locale={locale.locale}
          tt={tt}
          headingRef={headingRef}
          page={Math.min(cardPage, Math.max(1, pageCount || cardPage))}
          hrefFor={(page) => searchHref(urlQuery, page)}
          onPage={() => {
            pageFocus.current = true;
          }}
        />
      </div>
    </PageShell>
  );
});

type Translate = (key: string, vars?: Record<string, string | number>) => string;

type ListProps = {
  data: GlobalSearchResult | undefined;
  locale: 'zh-CN' | 'en-US';
  tt: Translate;
  hasFilters: boolean;
  onClearFilters: () => void;
  busy: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  page: number;
  hrefFor: (page: number) => string;
  onPage: () => void;
};

function SearchResults({
  query,
  liveCanRequest,
  parsedOk,
  canRequest,
  view,
  onRetry,
  retryRef,
  ...list
}: ListProps & {
  query: string;
  liveCanRequest: boolean;
  parsedOk: boolean;
  canRequest: boolean;
  view: 'error' | 'loading' | 'ready';
  onRetry: () => void;
  retryRef: RefObject<HTMLButtonElement | null>;
}) {
  const { data, tt } = list;
  if (!query.trim()) {
    return <p className="text-sm text-neutral-600">{tt('search.prompt')}</p>;
  }

  if (!parsedOk) {
    if (!data) return null;
    return (
      <div className="opacity-60">
        <ResultLists {...list} />
      </div>
    );
  }

  if (!liveCanRequest) {
    return <p className="text-sm text-neutral-600">{tt('search.prompt')}</p>;
  }

  // Error before loading (CH-202 §9): a retry in flight keeps the ErrorBox.
  if (canRequest && view === 'error') {
    return (
      <ErrorBox
        headingAs="h2"
        title={tt('form.searchFailed')}
        retryLabel={tt('state.retry')}
        retryingLabel={tt('state.retrying')}
        retrying={list.busy}
        retry={onRetry}
        retryClassName={dataErrorRetryClassName}
        retryRef={retryRef}
      />
    );
  }

  if (!data || view === 'loading') return <SearchSkeleton />;
  // A page past the end is being replaced with the last page.
  if (data.cards.length === 0 && data.cardTotal > 0) return <SearchSkeleton />;

  return <ResultLists {...list} />;
}

function ResultLists({
  data,
  locale,
  tt,
  hasFilters,
  onClearFilters,
  busy,
  headingRef,
  page,
  hrefFor,
  onPage,
}: ListProps) {
  const cards = data?.cards ?? [];
  const series = data?.series ?? [];
  const cardTotal = data?.cardTotal ?? cards.length;
  const pageCount = Math.max(1, Math.ceil(cardTotal / SEARCH_PAGE_SIZE));
  const pagination = (place: 'top' | 'bottom', className: string) => (
    <PagePagination
      label={tt(place === 'top' ? 'pagination.top' : 'pagination.bottom')}
      previousLabel={tt('pagination.prev')}
      nextLabel={tt('pagination.next')}
      pageLabel={(item) => tt('pagination.page', { page: item })}
      page={Math.min(page, pageCount)}
      pageCount={pageCount}
      hrefFor={hrefFor}
      onPage={onPage}
      className={className}
    />
  );
  if (cards.length === 0 && series.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-600">
        <p>{tt('search.empty')}</p>
        <p className="mt-2 text-sm text-neutral-600">{tt('search.emptyHint')}</p>
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
          {/*
            The heading row stays h-7 (28px) like the loading slot, so the
            first row does not move (§6). The top pagination shares the row;
            -my-0.5 keeps its 32px buttons from growing the row.
          */}
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h2
              id="sr-cards"
              ref={headingRef}
              tabIndex={-1}
              className="scroll-mt-20 text-lg font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {tt('search.cardsHeading', { count: cardTotal })}
            </h2>
            {pageCount > 1 ? pagination('top', '-my-0.5') : null}
          </div>
          <ul className={RESULT_LIST_CLASS} aria-busy={busy ? true : undefined}>
            {cards.map((card) => {
              const rarity = knownRarity(card.rarity);
              return (
                <li key={card.slug}>
                  <Link to={`/cards/${card.slug}`} className={RESULT_LINK_CLASS}>
                    <CardThumb src={card.imageUrl} slug={card.slug} width="w-10" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-neutral-900 wrap-anywhere">
                        {card.name}
                      </span>
                      <CardNumberSubsetLine
                        cardNumber={card.cardNumber}
                        subsetName={card.subsetName}
                        subsetSlug={card.subsetSlug}
                      />
                      <span className="block text-xs text-neutral-600 wrap-anywhere">
                        {card.seriesTitle}
                      </span>
                      <CardVariantBadgeRow
                        locale={locale}
                        parallelName={card.parallelName}
                        printRun={card.printRun}
                        isParallel={card.isParallel}
                        className="mt-2 flex flex-wrap gap-1"
                      />
                    </span>
                    {rarity ? <RarityBadge rarity={rarity} locale={locale} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          {pageCount > 1 ? pagination('bottom', 'justify-center') : null}
        </section>
      ) : null}
    </div>
  );
}
