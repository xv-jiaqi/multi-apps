import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SegmentedControl,
} from '@repo/ui-web';
import {
  LISTING_CONDITION_VALUES,
  LISTING_KIND_VALUES,
  LISTING_LANGUAGE_VALUES,
  TRADE_CURRENCY_VALUES,
  t,
  type ListingCondition,
  type ListingKind,
  type ListingLanguage,
  type ListingSort,
  type TradeCurrency,
} from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { ErrorBox } from '../components/error-box';
import { queryFallback, useFocusOnRecovery } from '../components/retry-button';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { ReportButton } from '../components/report-button';
import { ListingCloseControl } from '../components/listing-close-control';
import { CardPicker, type CardPickerItem } from '../components/card-picker';
import { CardThumb, isHttpsImageUrl } from '../components/card-thumb';

const KIND_OPTIONS: Array<{ value: 'all' | ListingKind; labelKey: string }> = [
  { value: 'all', labelKey: 'trade.list.filterAll' },
  { value: 'SELL', labelKey: 'trade.list.filterSell' },
  { value: 'BUY', labelKey: 'trade.list.filterBuy' },
];
const SORT_OPTIONS: ListingSort[] = ['newest', 'price_asc', 'price_desc'];

function isListingKind(value: string | null): value is ListingKind {
  return LISTING_KIND_VALUES.includes(value as ListingKind);
}
function isCondition(value: string | null): value is ListingCondition {
  return LISTING_CONDITION_VALUES.includes(value as ListingCondition);
}
function isLanguage(value: string | null): value is ListingLanguage {
  return LISTING_LANGUAGE_VALUES.includes(value as ListingLanguage);
}
function isTradeCurrency(value: string | null): value is TradeCurrency {
  return TRADE_CURRENCY_VALUES.includes(value as TradeCurrency);
}
function isSort(value: string | null): value is ListingSort {
  return value === 'newest' || value === 'price_asc' || value === 'price_desc';
}
function parsePrice(value: string | null) {
  if (!value || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function formatPrice(price: string | null, currency: string, fallback: string, locale: string) {
  if (!price) return fallback;
  const value = Number(price);
  if (!Number.isFinite(value)) return `${price} ${currency}`;
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
    } catch {
      // Historical free-text currencies are rendered below without currency style.
    }
  }
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency}`;
}

export const TradeListPage = observer(function TradeListPage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [filtersOpen, setFiltersOpen] = useState(false);
  // True only after the user picks a currency. Price-sort defaults and a
  // range that copies that default stay false, so leaving those modes can
  // drop the currency query param.
  const [currencyChosenByUser, setCurrencyChosenByUser] = useState(() =>
    isTradeCurrency(searchParams.get('currency')),
  );
  const [priceDraft, setPriceDraft] = useState(() =>
    isTradeCurrency(searchParams.get('currency'))
      ? { min: searchParams.get('min') ?? '', max: searchParams.get('max') ?? '' }
      : { min: '', max: '' },
  );
  const [closedNotice, setClosedNotice] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const utils = trpc.useUtils();

  const rawKind = searchParams.get('kind');
  const rawCondition = searchParams.get('condition');
  const rawLanguage = searchParams.get('language');
  const rawCurrency = searchParams.get('currency');
  const rawSort = searchParams.get('sort');
  const kindFilter: 'all' | ListingKind = isListingKind(rawKind) ? rawKind : 'all';
  const cardSlugFilter = searchParams.get('card') ?? '';
  const conditionFilter: ListingCondition | undefined = isCondition(rawCondition)
    ? rawCondition
    : undefined;
  const languageFilter: ListingLanguage | undefined = isLanguage(rawLanguage)
    ? rawLanguage
    : undefined;
  const currencyInUrl: TradeCurrency | undefined = isTradeCurrency(rawCurrency)
    ? rawCurrency
    : undefined;
  const sort: ListingSort = isSort(rawSort) ? rawSort : 'newest';
  const priceSort = sort === 'price_asc' || sort === 'price_desc';
  // A price sort without a currency is not a valid API query. Default the
  // request (and the currency control) to CNY, but do not write that default
  // into the URL. A shared min/max without currency is ignored and removed.
  const currencyFilter: TradeCurrency | undefined =
    currencyInUrl ?? (priceSort ? 'CNY' : undefined);
  const minPrice = currencyInUrl ? parsePrice(searchParams.get('min')) : undefined;
  const maxPrice = currencyInUrl ? parsePrice(searchParams.get('max')) : undefined;
  const priceInvalid =
    minPrice !== undefined &&
    maxPrice !== undefined &&
    Number.isFinite(minPrice) &&
    Number.isFinite(maxPrice) &&
    minPrice > maxPrice;

  useEffect(() => {
    const min = searchParams.get('min');
    const max = searchParams.get('max');
    if ((!min && !max) || isTradeCurrency(searchParams.get('currency'))) return;
    const next = new URLSearchParams(searchParams);
    next.delete('min');
    next.delete('max');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    if (!isTradeCurrency(searchParams.get('currency'))) {
      setPriceDraft({ min: '', max: '' });
      return;
    }
    setPriceDraft({ min: searchParams.get('min') ?? '', max: searchParams.get('max') ?? '' });
  }, [searchParams]);
  useEffect(() => {
    if (closedNotice) noticeRef.current?.focus();
  }, [closedNotice]);

  const selectedCardQuery = trpc.cards.bySlug.useQuery(
    { slug: cardSlugFilter },
    { enabled: cardSlugFilter.length > 0, retry: false },
  );
  const selectedCard: CardPickerItem | null = selectedCardQuery.data
    ? {
        slug: selectedCardQuery.data.slug,
        name: selectedCardQuery.data.name,
        rarity: selectedCardQuery.data.rarity,
        imageUrl: selectedCardQuery.data.imageUrl,
        seriesSlug: selectedCardQuery.data.seriesSlug,
        seriesTitle: selectedCardQuery.data.seriesTitle,
      }
    : null;

  const query = trpc.listings.list.useInfiniteQuery(
    {
      limit: 20,
      kind: kindFilter === 'all' ? undefined : kindFilter,
      cardSlug: cardSlugFilter || undefined,
      condition: conditionFilter,
      language: languageFilter,
      currency: currencyFilter,
      minPrice: Number.isFinite(minPrice) ? minPrice : undefined,
      maxPrice: Number.isFinite(maxPrice) ? maxPrice : undefined,
      sort,
    },
    {
      enabled: !priceInvalid,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      retry: (count, error) => error.data?.code !== 'BAD_REQUEST' && count < 1,
    },
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const listView = queryFallback(query);
  const filterInvalid = query.error?.data?.code === 'BAD_REQUEST';
  useFocusOnRecovery(listView, titleRef);
  const activeFilterCount = [
    kindFilter !== 'all',
    cardSlugFilter,
    conditionFilter,
    languageFilter,
    currencyFilter,
    minPrice !== undefined || maxPrice !== undefined,
    sort !== 'newest',
  ].filter(Boolean).length;
  const hasAnyFilter = activeFilterCount > 0;

  function updateParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }
  function clearAllFilters() {
    setCurrencyChosenByUser(false);
    setPriceDraft({ min: '', max: '' });
    setSearchParams(new URLSearchParams(), { replace: true });
  }
  function clearInvalidFilters() {
    clearAllFilters();
    titleRef.current?.focus({ preventScroll: true });
  }
  function clearCurrency() {
    setCurrencyChosenByUser(false);
    setPriceDraft({ min: '', max: '' });
    updateParams({
      currency: null,
      min: null,
      max: null,
      ...(priceSort ? { sort: null } : {}),
    });
  }
  function clearAutoCurrency(): Record<string, string | null> {
    if (currencyChosenByUser) return {};
    return { currency: null };
  }
  function leavePriceSort() {
    updateParams({ sort: null, ...clearAutoCurrency() });
  }
  function clearPriceRange() {
    setPriceDraft({ min: '', max: '' });
    updateParams({ min: null, max: null, ...clearAutoCurrency() });
  }
  function commitPriceRange() {
    if (!currencyFilter) return;
    const min = priceDraft.min.trim();
    const max = priceDraft.max.trim();
    if (!min && !max) {
      clearPriceRange();
      return;
    }
    // A price sort defaults the control to CNY without putting currency in the
    // URL. min/max are ignored unless currency is present, so write that
    // default together with the range (shared links like ?sort=price_asc).
    updateParams({
      currency: currencyInUrl ?? currencyFilter,
      min,
      max,
    });
  }
  const priceRangeLabel =
    minPrice !== undefined && maxPrice !== undefined
      ? `${searchParams.get('min')}–${searchParams.get('max')} ${currencyInUrl}`
      : minPrice !== undefined
        ? `≥ ${searchParams.get('min')} ${currencyInUrl}`
        : maxPrice !== undefined
          ? `≤ ${searchParams.get('max')} ${currencyInUrl}`
          : '';

  return (
    <PageShell>
      <PageMeta title={tt('trade.list.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('trade.list.title') }]}
        />
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1
              ref={titleRef}
              tabIndex={-1}
              className="text-3xl font-bold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {tt('trade.list.title')}
            </h1>
            <p className="text-neutral-600">{tt('trade.list.subtitle')}</p>
          </div>
          {session.isAuthenticated ? (
            <Button asChild>
              <Link to="/trade/new">{tt('trade.list.publish')}</Link>
            </Button>
          ) : (
            <Link
              to="/login"
              state={{ from: '/trade' }}
              className="text-sm text-brand-600 hover:underline"
            >
              {tt('trade.list.loginToPublish')}
            </Link>
          )}
        </header>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {tt('trade.list.disclaimer')}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <SegmentedControl
              legend={tt('trade.publish.kind')}
              legendSrOnly
              name="trade-kind"
              value={kindFilter}
              onValueChange={(value) => updateParams({ kind: value === 'all' ? null : value })}
              options={KIND_OPTIONS.map((option) => ({
                value: option.value,
                label: tt(option.labelKey),
              }))}
              fullWidth
              className="w-full sm:w-auto"
            />
            <div className="w-full sm:w-72">
              <label className="mb-1 block text-xs font-medium text-neutral-600">
                {tt('trade.list.cardFilter')}
              </label>
              <CardPicker
                locale={locale.locale}
                value={selectedCard}
                onValueChange={(card) => updateParams({ card: card?.slug ?? null })}
                clearLabel={tt('trade.filter.clear', { label: tt('trade.list.cardFilter') })}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:hidden"
              aria-expanded={filtersOpen}
              aria-controls="trade-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {activeFilterCount > 0
                ? tt('trade.filter.toggleCount', { count: activeFilterCount })
                : tt('trade.filter.toggle')}
            </Button>
          </div>
          <div
            id="trade-filters"
            data-open={filtersOpen ? 'true' : undefined}
            className="hidden flex-wrap items-start gap-3 sm:flex data-[open=true]:flex"
          >
            <FilterField label={tt('trade.condition.label')} className="w-full sm:w-40">
              <Select
                value={conditionFilter ?? 'any'}
                onValueChange={(value) =>
                  updateParams({ condition: value === 'any' ? null : value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="any">{tt('trade.filter.any')}</SelectItem>
                    {LISTING_CONDITION_VALUES.map((condition) => (
                      <SelectItem key={condition} value={condition}>
                        {tt(`trade.condition.${condition}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label={tt('trade.language.label')} className="w-full sm:w-32">
              <Select
                value={languageFilter ?? 'any'}
                onValueChange={(value) =>
                  updateParams({ language: value === 'any' ? null : value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="any">{tt('trade.filter.any')}</SelectItem>
                    {LISTING_LANGUAGE_VALUES.map((language) => (
                      <SelectItem key={language} value={language}>
                        {tt(`trade.language.${language}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FilterField>
            <fieldset className="w-full sm:w-auto">
              <legend className="mb-1 text-xs font-medium text-neutral-600">
                {tt('trade.filter.priceRange')}
              </legend>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="w-28"
                  inputMode="decimal"
                  disabled={!currencyFilter}
                  aria-invalid={priceInvalid}
                  aria-label={tt('trade.filter.minPrice')}
                  value={currencyFilter ? priceDraft.min : ''}
                  onChange={(event) =>
                    setPriceDraft((draft) => ({ ...draft, min: event.target.value }))
                  }
                  onBlur={commitPriceRange}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitPriceRange();
                  }}
                  placeholder={tt('trade.filter.minPrice')}
                />
                <span aria-hidden="true" className="text-neutral-500">
                  –
                </span>
                <Input
                  className="w-28"
                  inputMode="decimal"
                  disabled={!currencyFilter}
                  aria-invalid={priceInvalid}
                  aria-label={tt('trade.filter.maxPrice')}
                  value={currencyFilter ? priceDraft.max : ''}
                  onChange={(event) =>
                    setPriceDraft((draft) => ({ ...draft, max: event.target.value }))
                  }
                  onBlur={commitPriceRange}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitPriceRange();
                  }}
                  placeholder={tt('trade.filter.maxPrice')}
                />
                <Select
                  value={currencyFilter ?? 'any'}
                  onValueChange={(value) => {
                    if (value === 'any') clearCurrency();
                    else {
                      setCurrencyChosenByUser(true);
                      updateParams({ currency: value });
                    }
                  }}
                >
                  <SelectTrigger className="w-28" aria-label={tt('trade.publish.currency')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="any" disabled={sort !== 'newest'}>
                        {tt('trade.filter.any')}
                      </SelectItem>
                      {TRADE_CURRENCY_VALUES.map((currency) => (
                        <SelectItem key={currency} value={currency}>
                          {currency}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              {!currencyFilter ? (
                <p className="mt-1 text-xs text-neutral-600">
                  {tt('trade.filter.priceNeedsCurrency')}
                </p>
              ) : null}
              {priceInvalid ? (
                <p className="mt-1 text-xs text-red-700">{tt('trade.filter.priceInvalid')}</p>
              ) : null}
            </fieldset>
            <FilterField label={tt('trade.sort.label')} className="w-full sm:w-44">
              <Select
                value={sort}
                onValueChange={(value) => {
                  const nextSort = value as ListingSort;
                  if (nextSort === 'newest') leavePriceSort();
                  else updateParams({ sort: nextSort });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {tt(`trade.sort.${option}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {sort !== 'newest' && currencyFilter ? (
                <p className="mt-1 text-xs text-neutral-600">
                  {tt('trade.sort.currencyHint', { currency: currencyFilter })}
                </p>
              ) : null}
            </FilterField>
          </div>
          {activeFilterCount > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {kindFilter !== 'all' ? (
                <FilterChip
                  label={tt(
                    kindFilter === 'SELL' ? 'trade.list.filterSell' : 'trade.list.filterBuy',
                  )}
                  clearLabel={tt('trade.filter.clear', { label: tt('trade.publish.kind') })}
                  onClear={() => updateParams({ kind: null })}
                />
              ) : null}
              {cardSlugFilter ? (
                <FilterChip
                  label={selectedCard?.name ?? cardSlugFilter}
                  clearLabel={tt('trade.filter.clear', { label: tt('trade.list.cardFilter') })}
                  onClear={() => updateParams({ card: null })}
                />
              ) : null}
              {conditionFilter ? (
                <FilterChip
                  label={tt(`trade.condition.${conditionFilter}`)}
                  clearLabel={tt('trade.filter.clear', { label: tt('trade.condition.label') })}
                  onClear={() => updateParams({ condition: null })}
                />
              ) : null}
              {languageFilter ? (
                <FilterChip
                  label={tt(`trade.language.${languageFilter}`)}
                  clearLabel={tt('trade.filter.clear', { label: tt('trade.language.label') })}
                  onClear={() => updateParams({ language: null })}
                />
              ) : null}
              {currencyFilter ? (
                <FilterChip
                  label={currencyFilter}
                  clearLabel={tt('trade.filter.clear', { label: tt('trade.publish.currency') })}
                  onClear={clearCurrency}
                />
              ) : null}
              {priceRangeLabel ? (
                <FilterChip
                  label={priceRangeLabel}
                  clearLabel={tt('trade.filter.clear', { label: tt('trade.filter.priceRange') })}
                  onClear={clearPriceRange}
                />
              ) : null}
              {sort !== 'newest' ? (
                <FilterChip
                  label={tt(`trade.sort.${sort}`)}
                  clearLabel={tt('trade.filter.clear', { label: tt('trade.sort.label') })}
                  onClear={leavePriceSort}
                />
              ) : null}
              <Button type="button" variant="link" size="sm" onClick={clearAllFilters}>
                {tt('trade.filter.clearAll')}
              </Button>
            </div>
          ) : null}
        </div>

        {closedNotice ? (
          <p
            ref={noticeRef}
            role="status"
            tabIndex={-1}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {tt('trade.closed')}
          </p>
        ) : null}
        {filterInvalid ? (
          <div
            role="alert"
            className="rounded-lg border border-dashed border-neutral-300 p-8 text-center"
          >
            <p className="font-medium text-neutral-700">{tt('trade.filter.invalid')}</p>
            <Button type="button" variant="outline" className="mt-4" onClick={clearInvalidFilters}>
              {tt('trade.filter.clearInvalid')}
            </Button>
          </div>
        ) : listView === 'error' ? (
          <ErrorBox
            title={tt('state.error')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={query.isFetching}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : listView === 'loading' ? (
          <ListingSkeleton />
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-600">
            <p>{hasAnyFilter ? tt('trade.filter.empty') : tt('trade.list.empty')}</p>
            {hasAnyFilter ? (
              <Button type="button" variant="outline" className="mt-4" onClick={clearAllFilters}>
                {tt('trade.filter.clearAll')}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {items.map((listing) => {
                const isMine = session.isAuthenticated && listing.seller?.id === session.user?.id;
                const canClose = isMine || session.isAdmin;
                const facets = [
                  listing.condition ? tt(`trade.condition.${listing.condition}`) : null,
                  listing.language ? tt(`trade.language.${listing.language}`) : null,
                  listing.variantNote,
                ]
                  .filter(Boolean)
                  .join(' · ');
                const titleId = `listing-${listing.id}-title`;
                return (
                  <li key={listing.id}>
                    <article
                      aria-labelledby={titleId}
                      className="rounded-2xl border border-white/60 bg-white/70 p-4 shadow-sm backdrop-blur sm:p-5"
                    >
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                        {listing.card ? (
                          <Link to={`/cards/${listing.card.slug}`} tabIndex={-1} aria-hidden="true">
                            <CardThumb
                              src={listing.card.imageUrl}
                              slug={listing.card.slug}
                              width="w-16"
                            />
                          </Link>
                        ) : (
                          <CardThumb src={null} slug={listing.cardSlug} width="w-16" />
                        )}
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <KindChip
                              kind={listing.kind}
                              label={tt(
                                listing.kind === 'SELL'
                                  ? 'trade.list.kindSell'
                                  : 'trade.list.kindBuy',
                              )}
                            />
                            {listing.card ? (
                              <h2 id={titleId} className="min-w-0 truncate text-base font-semibold">
                                <Link
                                  to={`/cards/${listing.card.slug}`}
                                  className="text-neutral-900 hover:underline"
                                >
                                  {listing.card.name}
                                </Link>
                              </h2>
                            ) : (
                              <h2 id={titleId} className="flex min-w-0 items-center gap-2">
                                <span className="font-mono text-sm text-neutral-700">
                                  {listing.cardSlug}
                                </span>
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                                  {tt('trade.list.cardDelisted')}
                                </span>
                              </h2>
                            )}
                          </div>
                          {listing.card ? (
                            <p className="truncate text-xs text-neutral-600">
                              {listing.card.seriesTitle}
                            </p>
                          ) : null}
                          <p className="text-lg font-semibold text-neutral-900">
                            {formatPrice(
                              listing.price,
                              listing.currency,
                              tt('trade.list.priceFree'),
                              locale.locale,
                            )}
                          </p>
                          {facets ? <p className="text-xs text-neutral-600">{facets}</p> : null}
                          <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[6rem_1fr]">
                            <dt className="text-xs uppercase tracking-widest text-neutral-500">
                              {tt('trade.list.contact')}
                            </dt>
                            <dd className="min-w-0 font-mono text-neutral-800 wrap-anywhere">
                              {listing.contact === null ? (
                                <Link
                                  to="/login"
                                  state={{ from: `${location.pathname}${location.search}` }}
                                  className="text-brand-600 hover:underline"
                                >
                                  {tt('trade.list.contactSignIn')}
                                </Link>
                              ) : (
                                listing.contact
                              )}
                            </dd>
                            {listing.note ? (
                              <>
                                <dt className="text-xs uppercase tracking-widest text-neutral-500">
                                  {tt('trade.list.note')}
                                </dt>
                                <dd className="min-w-0 whitespace-pre-wrap text-neutral-700 wrap-anywhere">
                                  {listing.note}
                                </dd>
                              </>
                            ) : null}
                          </dl>
                          <PhotoList urls={listing.imageUrls.slice(0, 4)} tt={tt} />
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-1">
                            <p className="text-xs text-neutral-600">
                              @{listing.seller?.username ?? '-'} ·{' '}
                              <time dateTime={listing.createdAt} className="whitespace-nowrap">
                                {new Date(listing.createdAt).toLocaleString(locale.locale, {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })}
                              </time>
                            </p>
                            {!isMine ? (
                              <ReportButton targetType="LISTING" targetId={listing.id}>
                                {({ trigger, form }) => (
                                  <>
                                    <div className="ml-auto flex items-center gap-2">{trigger}</div>
                                    {form}
                                  </>
                                )}
                              </ReportButton>
                            ) : null}
                            {canClose ? (
                              <ListingCloseControl
                                listingId={listing.id}
                                showReason={session.isAdmin && !isMine}
                                confirming={confirmingId === listing.id}
                                onConfirmingChange={(open) =>
                                  setConfirmingId((current) =>
                                    open ? listing.id : current === listing.id ? null : current,
                                  )
                                }
                                onClosed={() => {
                                  void utils.listings.list.invalidate();
                                  void utils.listings.byCard.invalidate();
                                  void utils.listings.mine.invalidate();
                                  setClosedNotice(true);
                                }}
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
            {query.hasNextPage ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const result = await query.fetchNextPage();
                    if (result.isError) void query.refetch();
                  }}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? tt('state.loading') : tt('trade.list.loadMore')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
});

function FilterField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}
function FilterChip({
  label,
  clearLabel,
  onClear,
}: {
  label: string;
  clearLabel: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-full border border-neutral-300 bg-white pl-3 pr-1 text-xs text-neutral-700">
      {label}
      <button
        type="button"
        aria-label={clearLabel}
        onClick={onClear}
        className="inline-flex size-6 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        ×
      </button>
    </span>
  );
}
function KindChip({ kind, label }: { kind: ListingKind; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${kind === 'SELL' ? 'bg-brand-50 text-brand-700' : 'bg-neutral-100 text-neutral-700'}`}
    >
      {label}
    </span>
  );
}
function PhotoFallbackLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-16 items-center rounded-md border border-neutral-200 bg-white px-2 text-xs text-brand-600 hover:underline"
    >
      {label}
    </a>
  );
}
function TradePhoto({
  url,
  index,
  total,
  tt,
}: {
  url: string;
  index: number;
  total: number;
  tt: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [failed, setFailed] = useState(false);
  const fallback = tt('trade.list.photoFallback', { index: index + 1 });
  if (!isHttpsImageUrl(url) || failed) return <PhotoFallbackLink url={url} label={fallback} />;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={tt('trade.list.photoOpen', { index: index + 1, total })}
      className="block size-16 overflow-hidden rounded-md bg-neutral-100 ring-1 ring-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
    >
      <img
        ref={(img) => {
          if (img?.complete && img.naturalWidth === 0) setFailed(true);
        }}
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="size-full object-cover"
        onError={() => setFailed(true)}
      />
    </a>
  );
}
function PhotoList({
  urls,
  tt,
}: {
  urls: string[];
  tt: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (urls.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={tt('trade.list.photos')}>
      {urls.map((url, index) => (
        <li key={`${url}-${index}`}>
          <TradePhoto url={url} index={index} total={urls.length} tt={tt} />
        </li>
      ))}
    </ul>
  );
}
function ListingSkeleton() {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <li
          key={index}
          className="animate-pulse motion-reduce:animate-none rounded-2xl border border-white/60 bg-white/50 p-4 sm:p-5"
        >
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
            <div className="aspect-[63/88] w-16 rounded-sm bg-neutral-200" />
            <div className="space-y-3">
              <div className="h-4 w-1/3 rounded bg-neutral-200" />
              <div className="h-5 w-1/4 rounded bg-neutral-200" />
              <div className="h-4 w-2/3 rounded bg-neutral-200" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
