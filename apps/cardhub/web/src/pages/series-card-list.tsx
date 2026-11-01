import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { observer } from 'mobx-react-lite';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import {
  CARD_RARITY_VALUES,
  CARD_SERIES_LIST_SORT_VALUES,
  isAppErrorCode,
  t,
  type CardRarity,
  type CardSeriesListSort,
  type Locale,
} from '@repo/shared';
import {
  Button,
  buttonVariants,
  cn,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui-web';
import { ART_ASPECT, ART_SURFACE, useArtImage } from '../components/artwork';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { queryFallback, useFocusOnRecovery } from '../components/retry-button';
import { CardVariantBadgeRow } from '../components/card-variant-badge';
import { RARITY_LABELS, RarityBadge } from '../components/rarity-badge';
import { displayCardNumber } from '../lib/catalog-taxonomy';
import { gradientFor } from '../lib/gradients';
import { useStores } from '../stores/root-store';
import {
  SERIES_LIST_ANY,
  SERIES_LIST_PAGE_SIZE,
  pageTokens,
  parseSeriesListParams,
  seriesCardAttributeLine,
  seriesListSearch,
  type SeriesListState,
} from '../lib/series-list-params';
import { useDebounced } from '../lib/use-debounced';
import { trpc } from '../lib/trpc';

const SEARCH_DEBOUNCE_MS = 300;

function normalizeRarity(rarity: string | null): 'common' | 'rare' | 'epic' | 'legendary' {
  if (rarity === 'common' || rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') {
    return rarity;
  }
  return 'common';
}

type SeriesQueryError = { data?: { code?: string; appCode?: string } | null } | null;

function seriesFailureKey(error: SeriesQueryError): string {
  const appCode = error?.data?.appCode;
  const code = error?.data?.code;
  if (appCode === 'UNKNOWN' || code === 'UNKNOWN') return 'error.app.UNKNOWN';
  if (isAppErrorCode(appCode) || isAppErrorCode(code)) return 'error.app.INTERNAL_SERVER_ERROR';
  return 'error.app.UNKNOWN';
}

function SeriesCardArt({
  card,
}: {
  card: { slug: string; name: string; imageUrl: string | null };
}) {
  const art = useArtImage({
    src: card.imageUrl,
    alt: '',
    fit: 'cover',
    className: 'absolute inset-0',
  });
  const hasImage = art.mode === 'image';

  return (
    <div
      className={cn(
        'relative flex h-44 items-center justify-center bg-gradient-to-br',
        gradientFor(card.slug),
        hasImage && 'py-3',
      )}
      aria-hidden
    >
      {hasImage ? (
        <div
          className={cn(
            'relative h-full overflow-hidden rounded-md shadow-md',
            ART_ASPECT.card,
            ART_SURFACE,
            'ring-1 ring-black/10',
          )}
        >
          <img key={card.imageUrl ?? card.slug} {...art.imgProps} />
        </div>
      ) : (
        <span className="text-3xl font-black uppercase tracking-widest text-white/70">
          {card.name.slice(0, 1)}
        </span>
      )}
    </div>
  );
}

export function SeriesCardLink({
  card,
  locale,
  attributeLine,
}: {
  card: {
    slug: string;
    name: string;
    rarity: string | null;
    imageUrl: string | null;
    cardNumber?: string | null;
    parallelName?: string | null;
    printRun?: number | null;
    isParallel?: boolean;
  };
  locale: Locale;
  attributeLine: string | null;
}) {
  const number = card.cardNumber?.trim();
  return (
    <Link
      to={`/cards/${card.slug}`}
      className="group block overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-sm backdrop-blur transition-transform hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <SeriesCardArt card={card} />
      <div className="min-w-0 p-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0">
            {number ? (
              <span className="mr-2 font-mono text-xs tabular-nums text-neutral-600 wrap-anywhere">
                {displayCardNumber(number)}
              </span>
            ) : null}
            <span className="text-base font-semibold text-neutral-900 wrap-anywhere">
              {card.name}
            </span>
          </span>
          <RarityBadge rarity={normalizeRarity(card.rarity)} locale={locale} />
        </div>
        <CardVariantBadgeRow
          locale={locale}
          parallelName={card.parallelName}
          printRun={card.printRun}
          isParallel={card.isParallel}
          className="mt-2 flex flex-wrap gap-1"
        />
        {attributeLine ? (
          <p className="mt-1 truncate text-xs tabular-nums text-neutral-600">{attributeLine}</p>
        ) : null}
      </div>
    </Link>
  );
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

function scrollHeadingIntoView(node: HTMLElement) {
  node.focus({ preventScroll: true });
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}

type SubsetOption = { slug: string; name: string };

export const SeriesCardList = observer(function SeriesCardList({
  seriesSlug,
  subsets,
  fallbackCardCount,
}: {
  seriesSlug: string;
  subsets?: SubsetOption[];
  fallbackCardCount: number;
}) {
  const { locale: localeStore } = useStores();
  const locale = localeStore.locale;
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale, key, vars);
  const [searchParams, setSearchParams] = useSearchParams();
  const subsetOptions = subsets ?? [];
  const subsetSlugs = useMemo(
    () => new Set(subsetOptions.map((item) => item.slug)),
    [subsetOptions],
  );
  const parsed = useMemo(
    () => parseSeriesListParams(searchParams, subsetSlugs),
    [searchParams, subsetSlugs],
  );
  const state = parsed.state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const [draft, setDraft] = useState(state.q);
  const [trackedQ, setTrackedQ] = useState(state.q);
  const writtenQ = useRef<string | null>(null);
  if (state.q !== trackedQ) {
    setTrackedQ(state.q);
    if (writtenQ.current !== state.q) setDraft(state.q);
  }

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [announced, setAnnounced] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const pageFocus = useRef(false);
  const retryWasBusy = useRef(false);
  const failureKey = useRef('error.app.UNKNOWN');
  const debounced = useDebounced(draft, SEARCH_DEBOUNCE_MS);
  const searchId = useId();
  const subsetId = useId();
  const rarityId = useId();
  const sortId = useId();

  const commit = (next: SeriesListState, replace: boolean) => {
    if (next.q !== draft) {
      writtenQ.current = next.q;
      setDraft(next.q);
    }
    setSearchParams(seriesListSearch(next, searchParamsRef.current), { replace });
  };

  useEffect(() => {
    if (writtenQ.current === state.q) writtenQ.current = null;
  }, [state.q]);

  useEffect(() => {
    if (!parsed.replace) return;
    if (searchParams.toString() === parsed.search) return;
    setSearchParams(parsed.search, { replace: true });
  }, [parsed.replace, parsed.search, searchParams, setSearchParams]);

  useEffect(() => {
    const next = debounced.trim().slice(0, 200);
    if (next === stateRef.current.q) return;
    writtenQ.current = next;
    setSearchParams(
      seriesListSearch({ ...stateRef.current, q: next, page: 1 }, searchParamsRef.current),
      { replace: true },
    );
  }, [debounced, setSearchParams]);

  const list = trpc.cards.listBySeries.useQuery(
    {
      seriesSlug,
      page: state.page,
      pageSize: SERIES_LIST_PAGE_SIZE,
      ...(state.q ? { q: state.q } : {}),
      ...(state.subset ? { subsetSlug: state.subset } : {}),
      ...(state.rarity ? { rarity: state.rarity } : {}),
      ...(state.sort !== 'number' ? { sort: state.sort } : {}),
      ...(state.parallels ? { includeParallels: true } : {}),
    },
    { placeholderData: keepPreviousData },
  );
  const listView = queryFallback(list);
  useFocusOnRecovery(listView, titleRef);

  const seriesTotal =
    list.data && typeof list.data.seriesTotal === 'number'
      ? list.data.seriesTotal
      : fallbackCardCount;
  const filtered = state.q.length > 0 || state.subset !== null || state.rarity !== null;
  const total = list.data?.total ?? 0;
  const parallelCount = list.data?.parallelCount ?? 0;
  const announcement =
    !filtered && state.parallels
      ? tt('series.count.withParallels', { count: total, n: total })
      : tt(filtered ? 'series.list.found' : 'series.list.total', {
          count: filtered ? total : seriesTotal,
        });
  const onlyParallels =
    listView !== 'error' &&
    list.data !== undefined &&
    !list.isLoading &&
    !state.parallels &&
    !filtered &&
    seriesTotal === 0 &&
    parallelCount > 0;
  const emptySeries =
    !onlyParallels &&
    listView !== 'error' &&
    (list.data !== undefined
      ? seriesTotal === 0 && parallelCount === 0
      : seriesTotal === 0 && fallbackCardCount === 0);
  const pageCount = list.data ? Math.ceil(list.data.total / SERIES_LIST_PAGE_SIZE) : 0;

  useEffect(() => {
    if (!list.data || list.isFetching) return;
    setAnnounced(announcement);
  }, [announcement, list.data, list.isFetching]);

  useEffect(() => {
    if (!list.data || list.isFetching || list.isError) return;
    if (pageCount >= 1 && state.page > pageCount) {
      setSearchParams(
        seriesListSearch({ ...stateRef.current, page: pageCount }, searchParamsRef.current),
        { replace: true },
      );
    }
  }, [list.data, list.isError, list.isFetching, pageCount, setSearchParams, state.page]);

  const filtersWereOpen = useRef(false);
  useLayoutEffect(() => {
    if (filtersWereOpen.current && !filtersOpen) filterButtonRef.current?.focus();
    filtersWereOpen.current = filtersOpen;
  }, [filtersOpen]);

  useLayoutEffect(() => {
    if (!pageFocus.current || list.isFetching || !list.data) return;
    pageFocus.current = false;
    if (titleRef.current) scrollHeadingIntoView(titleRef.current);
  }, [list.data, list.isFetching]);

  useLayoutEffect(() => {
    const busy = listView === 'error' && list.isFetching;
    const failedRetry = retryWasBusy.current && !busy && listView === 'error';
    retryWasBusy.current = busy;
    const active = document.activeElement;
    // The button stays mounted, so a keyboard retry keeps its ring. Only pull
    // focus back when it fell to the document. Another control keeps focus.
    if (failedRetry && (active === null || active === document.body)) {
      retryRef.current?.focus({ preventScroll: true });
    }
  }, [list.isFetching, listView]);

  if (list.error) failureKey.current = seriesFailureKey(list.error);

  const activeFilters =
    (state.q ? 1 : 0) + (state.subset ? 1 : 0) + (state.rarity ? 1 : 0) + (state.parallels ? 1 : 0);
  const showSkeleton = !emptySeries && listView === 'loading' && !list.data;
  const showError = !emptySeries && listView === 'error';
  const showNoMatch =
    !emptySeries &&
    !showError &&
    list.data !== undefined &&
    list.data.items.length === 0 &&
    list.data.total === 0 &&
    !list.isLoading;
  const showGrid = !emptySeries && !showError && !!list.data && list.data.items.length > 0;

  const hrefFor = (next: SeriesListState) => {
    const search = seriesListSearch(next, searchParams);
    return search ? `/series/${seriesSlug}?${search}` : `/series/${seriesSlug}`;
  };

  return (
    <section className="min-w-0 space-y-4">
      {emptySeries ? null : (
        <search
          aria-label={tt('series.list.searchLandmark')}
          className="flex min-w-0 flex-wrap items-end gap-3"
        >
          <Field
            id={searchId}
            label={tt('series.list.search')}
            className="order-1 w-full sm:w-auto sm:min-w-0 sm:max-w-sm sm:flex-1"
          >
            <Input
              ref={inputRef}
              id={searchId}
              type="search"
              value={draft}
              maxLength={200}
              placeholder={tt('series.list.searchPlaceholder')}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <div className="order-2 flex w-full items-center gap-3 sm:hidden">
            <CountText text={announced} />
            <Button
              ref={filterButtonRef}
              type="button"
              variant="outline"
              size="sm"
              className="ms-auto"
              aria-expanded={filtersOpen}
              aria-controls="series-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {activeFilters > 0
                ? tt('series.list.filtersCount', { n: activeFilters })
                : tt('series.list.filters')}
            </Button>
          </div>
          <div
            id="series-filters"
            className={cn(
              'order-3 w-full gap-3',
              filtersOpen ? 'grid grid-cols-1' : 'hidden',
              'sm:contents',
            )}
          >
            {subsetOptions.length > 0 ? (
              <Field
                id={subsetId}
                label={tt('series.list.subset')}
                className="w-full sm:order-2 sm:w-40"
              >
                <Select
                  value={state.subset ?? SERIES_LIST_ANY}
                  onValueChange={(value) =>
                    commit(
                      { ...state, subset: value === SERIES_LIST_ANY ? null : value, page: 1 },
                      false,
                    )
                  }
                >
                  <SelectTrigger id={subsetId} className="w-full min-w-0 overflow-hidden">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={SERIES_LIST_ANY}>{tt('series.list.any')}</SelectItem>
                      {subsetOptions.map((subset) => (
                        <SelectItem
                          key={subset.slug}
                          value={subset.slug}
                          className="min-w-0 whitespace-normal wrap-anywhere"
                        >
                          {subset.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field
              id={rarityId}
              label={tt('series.list.rarity')}
              className="w-full sm:order-2 sm:w-40"
            >
              <Select
                value={state.rarity ?? SERIES_LIST_ANY}
                onValueChange={(value) =>
                  commit(
                    {
                      ...state,
                      rarity: value === SERIES_LIST_ANY ? null : rarityValue(value),
                      page: 1,
                    },
                    false,
                  )
                }
              >
                <SelectTrigger id={rarityId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={SERIES_LIST_ANY}>{tt('series.list.any')}</SelectItem>
                    {CARD_RARITY_VALUES.map((rarity) => (
                      <SelectItem key={rarity} value={rarity}>
                        {RARITY_LABELS[rarity][locale]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field id={sortId} label={tt('series.list.sort')} className="w-full sm:order-2 sm:w-40">
              <Select
                value={state.sort}
                onValueChange={(value) =>
                  commit({ ...state, sort: sortValue(value), page: 1 }, false)
                }
              >
                <SelectTrigger id={sortId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {CARD_SERIES_LIST_SORT_VALUES.map((sort) => (
                      <SelectItem key={sort} value={sort}>
                        {tt(`series.list.sort.${sort}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {parallelCount > 0 ? (
              <label
                htmlFor="series-parallels"
                className="inline-flex min-h-6 items-center gap-2 self-center text-sm text-neutral-900 sm:order-3"
              >
                <input
                  id="series-parallels"
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  checked={state.parallels}
                  onChange={(event) =>
                    commit({ ...state, parallels: event.target.checked, page: 1 }, false)
                  }
                />
                {tt('series.filters.parallels')}
              </label>
            ) : null}
          </div>
        </search>
      )}

      <div className="flex min-w-0 items-baseline gap-3">
        <h2
          id="cards-title"
          ref={titleRef}
          tabIndex={-1}
          className="scroll-mt-20 text-lg font-semibold text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {tt('series.detail.cardsTitle')}
        </h2>
        {emptySeries ? null : <CountText text={announced} className="ms-auto hidden sm:block" />}
      </div>

      {emptySeries ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-600">
          {tt('series.list.empty')}
        </p>
      ) : null}

      {showSkeleton ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="h-64 animate-pulse rounded-2xl bg-white/50 motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : null}

      {showError ? (
        <ErrorBox
          headingAs="h2"
          title={tt(failureKey.current)}
          retryLabel={tt('state.retry')}
          retryingLabel={tt('state.retrying')}
          retrying={list.isFetching}
          retry={() => {
            void list.refetch();
          }}
          retryClassName={dataErrorRetryClassName}
          retryRef={retryRef}
        />
      ) : null}

      {showNoMatch ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-600">
          <p>{tt('series.list.noMatch')}</p>
          {onlyParallels ? (
            <p className="mt-2 text-sm text-neutral-600">
              {tt('series.parallels.hint', { n: parallelCount })}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => {
              commit({ ...state, q: '', subset: null, rarity: null, page: 1 }, false);
              inputRef.current?.focus();
            }}
          >
            {tt('series.list.clear')}
          </Button>
        </div>
      ) : null}

      {showGrid && list.data ? (
        <ul
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy={list.isFetching ? true : undefined}
        >
          {list.data.items.map((card) => (
            <li key={card.slug} className="min-w-0">
              <SeriesCardLink
                card={card}
                locale={locale}
                attributeLine={seriesCardAttributeLine(
                  card.attributes,
                  list.data?.attributeLabels,
                  locale,
                )}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {!emptySeries && !showError && pageCount > 1 ? (
        <SeriesPagination
          label={tt('pagination.label')}
          previousLabel={tt('pagination.prev')}
          nextLabel={tt('pagination.next')}
          pageLabel={(page) => tt('pagination.page', { page })}
          positionLabel={tt('pagination.of', { page: state.page, count: pageCount })}
          page={Math.min(state.page, pageCount)}
          pageCount={pageCount}
          hrefFor={(page) => hrefFor({ ...state, page })}
          onPage={() => {
            pageFocus.current = true;
          }}
        />
      ) : null}
    </section>
  );
});

function CountText({ text, className }: { text: string | null; className?: string }) {
  return (
    <p role="status" aria-live="polite" className={cn('text-sm text-neutral-600', className)}>
      {text ?? ''}
    </p>
  );
}

function rarityValue(value: string): CardRarity {
  const matched = CARD_RARITY_VALUES.find((item) => item === value);
  return matched ?? 'common';
}

function sortValue(value: string): CardSeriesListSort {
  const matched = CARD_SERIES_LIST_SORT_VALUES.find((item) => item === value);
  return matched ?? 'number';
}

function SeriesPagination({
  label,
  previousLabel,
  nextLabel,
  pageLabel,
  positionLabel,
  page,
  pageCount,
  hrefFor,
  onPage,
}: {
  label: string;
  previousLabel: string;
  nextLabel: string;
  pageLabel: (page: number) => string;
  positionLabel: string;
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  onPage: () => void;
}) {
  const tokens = pageTokens(page, pageCount);
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-2">
      <PageEdge
        label={previousLabel}
        href={hrefFor(page - 1)}
        disabled={page <= 1}
        onPage={onPage}
      />
      <span className="text-sm text-neutral-600 sm:hidden">{positionLabel}</span>
      <ol className="hidden sm:contents">
        {tokens.map((token) =>
          token.kind === 'gap' ? (
            <li key={token.key} aria-hidden className="px-1 text-sm text-neutral-600">
              …
            </li>
          ) : (
            <li key={token.page} className="flex">
              <PageNumber
                page={token.page}
                current={token.page === page}
                href={hrefFor(token.page)}
                label={pageLabel(token.page)}
                onPage={onPage}
              />
            </li>
          ),
        )}
      </ol>
      <PageEdge
        label={nextLabel}
        href={hrefFor(page + 1)}
        disabled={page >= pageCount}
        onPage={onPage}
      />
    </nav>
  );
}

function PageEdge({
  label,
  href,
  disabled,
  onPage,
}: {
  label: string;
  href: string;
  disabled: boolean;
  onPage: () => void;
}) {
  if (disabled) {
    return (
      <span aria-disabled="true" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        {label}
      </span>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={href} onClick={onPage}>
        {label}
      </Link>
    </Button>
  );
}

function PageNumber({
  page,
  current,
  href,
  label,
  onPage,
}: {
  page: number;
  current: boolean;
  href: string;
  label: string;
  onPage: () => void;
}) {
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className={
        current ? 'bg-brand-600 text-white hover:bg-brand-600 hover:text-white' : undefined
      }
    >
      <Link
        to={href}
        aria-label={label}
        aria-current={current ? 'page' : undefined}
        onClick={onPage}
      >
        {page}
      </Link>
    </Button>
  );
}
