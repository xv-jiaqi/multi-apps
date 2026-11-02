import { useEffect, useId, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useSearchParams } from 'react-router';
import { t } from '@repo/shared';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui-web';
import { ReleaseItem } from '../components/release-item';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { PageMeta } from '../components/page-meta';
import { PageShell } from '../components/page-shell';
import { queryFallback, useFocusOnRecovery, type QueryView } from '../components/retry-button';
import {
  calendarMonthRange,
  dayHeading,
  groupCalendarReleases,
  monthHeading,
  parseCalendarMonth,
  shiftCalendarMonth,
  withinMonthLabel,
} from '../lib/calendar-month';
import type { ReleaseListItem } from '../lib/releases-list';
import { shanghaiToday } from '../lib/shanghai-date';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

const ALL_CATEGORIES = 'all';
const MONTH_PAGE_SIZE = 100;
const MAX_MONTH_PAGES = 50;

const monthButtonClass = 'min-h-10 w-full sm:w-auto';

function CalendarSkeleton() {
  return (
    <div aria-busy="true" className="space-y-8">
      {Array.from({ length: 2 }, (_, group) => (
        <div key={group} className="space-y-3">
          <div className="h-4 w-24 animate-pulse motion-reduce:animate-none rounded bg-white/50" />
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, card) => (
              <li
                key={card}
                className={`h-56 animate-pulse motion-reduce:animate-none rounded-2xl bg-white/50 ${
                  card > 0 ? 'hidden md:block' : ''
                }`}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function toCard(item: {
  id: string;
  title: string;
  releaseDate: string;
  region: ReleaseListItem['region'];
  note: string | null;
  sourceUrl: string | null;
  series: ReleaseListItem['series'];
  category: ReleaseListItem['category'];
}): ReleaseListItem {
  return {
    id: item.id,
    title: item.title,
    releaseDate: item.releaseDate,
    region: item.region,
    note: item.note,
    sourceUrl: item.sourceUrl,
    series: item.series,
    category: item.category,
  };
}

export const CalendarPage = observer(function CalendarPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawMonth = searchParams.get('month');
  const today = shanghaiToday();
  const month = parseCalendarMonth(rawMonth, today);
  const range = calendarMonthRange(month);
  const heading = monthHeading(locale.locale, month);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionSeed = useId();
  const categoryParam = searchParams.get('category') ?? '';
  const categoriesQuery = trpc.categories.list.useQuery();
  const categories = categoriesQuery.data?.items;
  const activeCategory = categories?.find((item) => item.slug === categoryParam);
  // §13: with a category in the URL, wait for categories.list so the full month never flashes.
  // If categories.list fails, send the raw slug; the API returns an empty list for unknown ones.
  const waitingForCategories = Boolean(categoryParam) && categoriesQuery.isPending;
  const categorySlug = categories ? activeCategory?.slug : categoryParam || undefined;
  const categoryLabel =
    activeCategory?.name ?? (categories ? undefined : categoryParam || undefined);

  useEffect(() => {
    if (rawMonth === month) return;
    setSearchParams(
      (current) => {
        const nextParams = new URLSearchParams(current);
        nextParams.set('month', month);
        return nextParams;
      },
      { replace: true },
    );
  }, [month, rawMonth, setSearchParams]);

  useEffect(() => {
    if (!categories || !categoryParam || activeCategory) return;
    setSearchParams(
      (current) => {
        const nextParams = new URLSearchParams(current);
        nextParams.delete('category');
        return nextParams;
      },
      { replace: true },
    );
  }, [activeCategory, categories, categoryParam, setSearchParams]);

  const replaceCategory = (value: string) => {
    setSearchParams(
      (current) => {
        const nextParams = new URLSearchParams(current);
        if (value === ALL_CATEGORIES) nextParams.delete('category');
        else nextParams.set('category', value);
        return nextParams;
      },
      { replace: true },
    );
  };

  const query = trpc.releases.list.useInfiniteQuery(
    {
      from: range?.from ?? month,
      to: range?.to ?? month,
      limit: MONTH_PAGE_SIZE,
      ...(categorySlug ? { categorySlug } : {}),
    },
    {
      enabled: range !== null && !waitingForCategories,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    },
  );
  const pageCount = query.data?.pages.length ?? 0;
  const capped = pageCount >= MAX_MONTH_PAGES && Boolean(query.hasNextPage);
  const base = queryFallback(query);
  const failed = base === 'error' || query.isFetchNextPageError || capped;
  const view: QueryView = waitingForCategories
    ? 'loading'
    : failed
      ? 'error'
      : base === 'loading' || query.isFetchingNextPage || Boolean(query.hasNextPage)
        ? 'loading'
        : 'ready';
  useFocusOnRecovery(view, contentRef);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (failed || !hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [failed, fetchNextPage, hasNextPage, isFetchingNextPage]);

  const items = view === 'ready' ? (query.data?.pages.flatMap((page) => page.items) ?? []) : [];
  const grouped = groupCalendarReleases(items, locale.locale);
  const status =
    view !== 'ready'
      ? ''
      : categoryLabel
        ? tt('calendar.monthStatusCategory', {
            month: heading,
            category: categoryLabel,
            count: items.length,
          })
        : tt('calendar.monthStatus', { month: heading, count: items.length });
  const onThisMonth = month === today.slice(0, 7);
  const previous = shiftCalendarMonth(month, -1);
  const next = shiftCalendarMonth(month, 1);

  const openMonth = (target: string | null) => {
    if (!target || target === month) return;
    setSearchParams((current) => {
      const nextParams = new URLSearchParams(current);
      nextParams.set('month', target);
      return nextParams;
    });
  };

  return (
    <PageShell>
      <PageMeta title={tt('calendar.title')} />
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
            {tt('calendar.title')}
          </h1>
          <p className="text-neutral-600">{tt('calendar.subtitle')}</p>
        </header>
        <nav
          aria-label={tt('calendar.monthNav')}
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
        >
          <h2
            tabIndex={-1}
            className="order-1 w-full text-xl font-semibold tabular-nums text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:order-2 sm:w-auto"
          >
            {heading}
          </h2>
          <div className="order-2 grid grid-cols-3 gap-2 sm:contents">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={`${monthButtonClass} sm:order-1`}
              aria-disabled={previous ? undefined : true}
              onClick={() => openMonth(previous)}
            >
              <span aria-hidden>‹</span>
              <span className="sr-only">{tt('calendar.prev')}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={`${monthButtonClass} sm:order-3`}
              aria-disabled={next ? undefined : true}
              onClick={() => openMonth(next)}
            >
              <span aria-hidden>›</span>
              <span className="sr-only">{tt('calendar.next')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`${monthButtonClass} sm:order-4`}
              aria-disabled={onThisMonth || undefined}
              onClick={() => openMonth(today.slice(0, 7))}
            >
              {tt('calendar.today')}
            </Button>
          </div>
        </nav>
        <div className="w-full sm:w-48">
          <label htmlFor="calendar-category" className="text-sm font-medium text-neutral-800">
            {tt('calendar.filter.category')}
          </label>
          <Select
            value={activeCategory ? activeCategory.slug : ALL_CATEGORIES}
            onValueChange={replaceCategory}
            disabled={!categoriesQuery.isSuccess}
          >
            <SelectTrigger id="calendar-category" size="sm" className="w-full scroll-mt-20">
              <span className="min-w-0 truncate">
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>{tt('calendar.filter.all')}</SelectItem>
              {(categories ?? []).map((category) => (
                <SelectItem key={category.slug} value={category.slug}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="sr-only" role="status">
          {status}
        </p>
        <div
          ref={contentRef}
          tabIndex={-1}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {view === 'loading' ? <CalendarSkeleton /> : null}
          {view === 'error' ? (
            <ErrorBox
              title={tt('calendar.loadError')}
              retryLabel={tt('state.retry')}
              retryingLabel={tt('state.retrying')}
              retrying={query.isFetching}
              retry={() => {
                void query.refetch();
              }}
              retryClassName={dataErrorRetryClassName}
            />
          ) : null}
          {view === 'ready' && items.length === 0 && !categorySlug ? (
            <p className="text-neutral-600">{tt('calendar.empty')}</p>
          ) : null}
          {view === 'ready' && items.length === 0 && categorySlug ? (
            <div className="space-y-2">
              <p className="text-neutral-600">
                {tt('calendar.emptyCategory', { category: categoryLabel ?? categorySlug })}
              </p>
              <Button
                type="button"
                variant="link"
                className="px-0"
                onClick={() => replaceCategory(ALL_CATEGORIES)}
              >
                {tt('calendar.showAllCategories')}
              </Button>
            </div>
          ) : null}
          {view === 'ready' && items.length > 0 ? (
            <div className="space-y-8">
              {grouped.days.map((group) => {
                const headingId = `${sectionSeed}-${group.date}`;
                return (
                  <section key={group.date} aria-labelledby={headingId} className="space-y-3">
                    <h3 id={headingId} className="text-sm font-semibold text-neutral-800">
                      {dayHeading(
                        locale.locale,
                        group.date,
                        group.date === today,
                        tt('calendar.todaySuffix'),
                      )}
                    </h3>
                    <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {group.items.map((item) => (
                        <li key={item.id} className="min-w-0">
                          <ReleaseItem item={toCard(item)} titleLevel="h4" showDate={false} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {grouped.monthOnly.length > 0 ? (
                <section aria-labelledby={`${sectionSeed}-month`} className="space-y-3">
                  <h3
                    id={`${sectionSeed}-month`}
                    className="text-sm font-semibold text-neutral-800"
                  >
                    {tt('calendar.monthOnly')}
                  </h3>
                  <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {grouped.monthOnly.map((item) => (
                      <li key={item.id} className="min-w-0">
                        <ReleaseItem
                          item={toCard(item)}
                          titleLevel="h4"
                          showDate
                          dateLabel={withinMonthLabel(locale.locale, month)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
});
