import { useRef, type FocusEvent, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { Button } from '@repo/ui-web';
import { t, type Locale } from '@repo/shared';
import { Artwork } from '../components/artwork';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { PageMeta } from '../components/page-meta';
import { PageShell } from '../components/page-shell';
import { ReleaseItem } from '../components/release-item';
import { queryFallback, useFocusOnRecovery, type QueryView } from '../components/retry-button';
import { formatCatalogDate } from '../lib/catalog-taxonomy';
import {
  isReleasedOnOrBefore,
  latestExcludingHero,
  pickHomeHero,
  type HomeSeries,
} from '../lib/home-hero';
import { useReleasesList } from '../lib/releases-list';
import { addCalendarDays, shanghaiToday } from '../lib/shanghai-date';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

type Translate = (key: string, vars?: Record<string, string | number>) => string;
type QueryLike<T> = {
  data: T | undefined;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  errorUpdateCount: number;
  dataUpdatedAt: number;
  refetch: () => Promise<unknown> | unknown;
};
type SeriesQuery = QueryLike<{ items: HomeSeries[] }>;
type CategoryQuery = QueryLike<{
  items: Array<{
    slug: string;
    name: string;
    description: string | null;
    seriesCount: number;
  }>;
}>;
type ReleasesQuery = ReturnType<typeof useReleasesList>;

const recoveryClass = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
const sectionLinkClass =
  'inline-flex min-h-6 items-center text-sm text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
const cardLinkClass =
  'group block overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-sm transition-transform hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

function revealFocusedCard(event: FocusEvent<HTMLAnchorElement>) {
  event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function SectionTitle({
  id,
  title,
  action,
}: {
  id: string;
  title: string;
  action?: { to: string; label: string };
}) {
  const heading = (
    <h2 id={id} className="text-2xl font-semibold tracking-tight text-neutral-900">
      {title}
    </h2>
  );
  if (!action) return heading;
  return (
    <div className="flex items-center justify-between gap-4">
      {heading}
      <Link to={action.to} className={sectionLinkClass}>
        {action.label} →
      </Link>
    </div>
  );
}

function LoadingCopy({ label }: { label: string }) {
  return <span className="sr-only">{label}</span>;
}

function Pulse({ className }: { className: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-2xl bg-white/50 motion-reduce:animate-none ${className}`}
    />
  );
}

function BlockError({
  title,
  tt,
  retrying,
  retry,
}: {
  title: string;
  tt: Translate;
  retrying: boolean;
  retry: () => void;
}) {
  return (
    <ErrorBox
      title={title}
      retryLabel={tt('state.retry')}
      retryingLabel={tt('state.retrying')}
      retrying={retrying}
      retry={retry}
      retryClassName={dataErrorRetryClassName}
    />
  );
}

function seriesFromRow(series: {
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  cardCount: number;
  releaseDate: string | null;
}): HomeSeries {
  return {
    slug: series.slug,
    title: series.title,
    description: series.description,
    coverUrl: series.coverUrl,
    cardCount: series.cardCount,
    releaseDate: series.releaseDate,
  };
}

function HomeHero({
  tt,
  locale,
  today,
  heroQuery,
  latestQuery,
}: {
  tt: Translate;
  locale: Locale;
  today: string;
  heroQuery: SeriesQuery;
  latestQuery: SeriesQuery;
}) {
  const heroView = queryFallback(heroQuery);
  const latestView = queryFallback(latestQuery);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusOnRecovery(heroView, panelRef);
  const filtered = heroQuery.data?.items[0];
  const filteredSeries = filtered ? seriesFromRow(filtered) : undefined;
  const filteredEligible =
    filteredSeries !== undefined && isReleasedOnOrBefore(filteredSeries.releaseDate, today);
  const newest = (latestQuery.data?.items ?? []).map(seriesFromRow);
  const waitingForFallback = heroView === 'ready' && !filteredEligible && latestView === 'loading';
  const pick =
    heroView === 'ready' && !waitingForFallback
      ? pickHomeHero(filteredSeries, newest, today)
      : null;

  let aside: ReactNode;
  if (heroView === 'error') {
    aside = (
      <BlockError
        title={tt('home.hero.loadFailed')}
        tt={tt}
        retrying={heroQuery.isFetching}
        retry={() => {
          void heroQuery.refetch();
        }}
      />
    );
  } else if (heroView === 'loading' || waitingForFallback) {
    aside = (
      <div aria-busy="true">
        <Pulse className="aspect-2/1" />
        <LoadingCopy label={tt('a11y.loading')} />
      </div>
    );
  } else if (pick) {
    const series = pick.series;
    aside = (
      <Link to={`/series/${series.slug}`} className={cardLinkClass}>
        <div className="relative" aria-hidden>
          <Artwork
            kind="series"
            src={series.coverUrl}
            slug={series.slug}
            name={series.title}
            decorative
            priority
            className="w-full"
          />
        </div>
        <div className="space-y-2 p-5">
          <p className="text-sm text-neutral-600">
            {pick.kind === 'recent' && series.releaseDate
              ? tt('home.hero.recent', {
                  date: formatCatalogDate(locale, series.releaseDate),
                })
              : tt('home.hero.latest')}
          </p>
          <h2 className="text-2xl font-semibold text-neutral-900">{series.title}</h2>
          {series.description ? (
            <p className="line-clamp-2 text-sm text-neutral-600">{series.description}</p>
          ) : null}
          <p className="text-sm text-neutral-600">
            {tt('home.hero.cardCount', { count: series.cardCount })}
          </p>
        </div>
      </Link>
    );
  } else {
    aside = null;
  }

  return (
    <section className="grid gap-10 lg:grid-cols-5 lg:items-center">
      <div className="space-y-6 lg:col-span-2">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
          {tt('welcome.title')}
        </h1>
        <p className="max-w-xl text-lg text-neutral-600">{tt('welcome.subtitle')}</p>
        <div className="flex flex-wrap gap-3">
          <Button
            asChild
            size="lg"
            className="w-full bg-brand-700 text-white hover:bg-brand-800 focus-visible:ring-brand-700 sm:w-auto"
          >
            <Link to="/series">{tt('welcome.cta.browse')}</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
            <Link to="/search">{tt('welcome.cta.search')}</Link>
          </Button>
        </div>
      </div>
      <div ref={panelRef} tabIndex={-1} className={`lg:col-span-3 ${recoveryClass}`}>
        {aside}
      </div>
    </section>
  );
}

function HomeCategories({ tt, query }: { tt: Translate; query: CategoryQuery }) {
  const view: QueryView = queryFallback(query);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusOnRecovery(view, panelRef);
  const items = query.data?.items ?? [];
  if (view === 'ready' && items.length === 0) return null;
  const visible = items.slice(0, 8);

  return (
    <section aria-labelledby="home-categories-title" className="space-y-4">
      <SectionTitle
        id="home-categories-title"
        title={tt('home.categories.title')}
        action={
          items.length > 8 ? { to: '/categories', label: tt('home.categories.all') } : undefined
        }
      />
      <div id="home-categories-panel" ref={panelRef} tabIndex={-1} className={recoveryClass}>
        {view === 'loading' ? (
          <div aria-busy="true">
            <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <li key={index} className={index >= 4 ? 'hidden lg:block' : undefined}>
                  <Pulse className="h-24" />
                </li>
              ))}
            </ul>
            <LoadingCopy label={tt('a11y.loading')} />
          </div>
        ) : null}
        {view === 'error' ? (
          <BlockError
            title={tt('home.categories.loadFailed')}
            tt={tt}
            retrying={query.isFetching}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : null}
        {view === 'ready' ? (
          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {visible.map((category) => (
              <li key={category.slug} className="min-w-0">
                <Link
                  to={`/categories/${category.slug}`}
                  className="block rounded-2xl border border-white/60 bg-white/70 p-5 shadow-sm hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <h3 className="min-w-0 text-lg font-semibold text-neutral-900 wrap-anywhere">
                    {category.name}
                  </h3>
                  {category.description ? (
                    <p className="mt-2 hidden text-sm text-neutral-600 lg:line-clamp-2">
                      {category.description}
                    </p>
                  ) : null}
                  <p className="mt-3 text-sm text-neutral-600">
                    {tt('category.seriesCount', { count: category.seriesCount })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function HomeLatest({
  tt,
  today,
  heroQuery,
  latestQuery,
}: {
  tt: Translate;
  today: string;
  heroQuery: SeriesQuery;
  latestQuery: SeriesQuery;
}) {
  const view = queryFallback(latestQuery);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusOnRecovery(view, panelRef);
  const heroView = queryFallback(heroQuery);
  const newest = (latestQuery.data?.items ?? []).map(seriesFromRow);
  const filtered = heroView === 'ready' ? heroQuery.data?.items[0] : undefined;
  const pick =
    heroView === 'ready'
      ? pickHomeHero(filtered ? seriesFromRow(filtered) : undefined, newest, today)
      : null;
  const cards = view === 'ready' ? latestExcludingHero(newest, pick?.series.slug) : [];
  if (view === 'ready' && cards.length < 1) return null;

  return (
    <section aria-labelledby="home-latest-title" className="space-y-4">
      <SectionTitle
        id="home-latest-title"
        title={tt('home.latest.title')}
        action={{ to: '/series', label: tt('home.latest.all') }}
      />
      <div id="home-latest-panel" ref={panelRef} tabIndex={-1} className={recoveryClass}>
        {view === 'loading' ? (
          <div aria-busy="true">
            <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <li key={index} className={index >= 2 ? 'hidden md:block' : undefined}>
                  <Pulse className="h-56" />
                </li>
              ))}
            </ul>
            <LoadingCopy label={tt('a11y.loading')} />
          </div>
        ) : null}
        {view === 'error' ? (
          <BlockError
            title={tt('home.latest.loadFailed')}
            tt={tt}
            retrying={latestQuery.isFetching}
            retry={() => {
              void latestQuery.refetch();
            }}
          />
        ) : null}
        {view === 'ready' ? (
          <ul className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-2 md:overflow-visible md:pb-0 lg:grid-cols-4">
            {cards.map((series) => (
              <li key={series.slug} className="w-64 shrink-0 snap-start md:w-auto">
                <Link
                  to={`/series/${series.slug}`}
                  onFocus={revealFocusedCard}
                  className={cardLinkClass}
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
                  </div>
                  <div className="space-y-2 p-5">
                    <h3 className="min-w-0 text-lg font-semibold text-neutral-900 wrap-anywhere">
                      {series.title}
                    </h3>
                    {series.description ? (
                      <p className="line-clamp-2 text-sm text-neutral-600">{series.description}</p>
                    ) : null}
                    <p className="text-sm text-neutral-600">
                      {tt('home.hero.cardCount', { count: series.cardCount })}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function HomeUpcoming({ tt, query }: { tt: Translate; query: ReleasesQuery }) {
  const view = queryFallback(query);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusOnRecovery(view, panelRef);
  const absent = query.data?.absent === true;
  const items = query.data && !query.data.absent ? query.data.items.slice(0, 3) : [];
  if (view === 'loading' || absent) return null;
  if (view === 'ready' && items.length === 0) return null;

  return (
    <section aria-labelledby="home-upcoming-title" className="space-y-4">
      {/* Homepage and footer stay without a calendar link. The header is the entry. */}
      <SectionTitle id="home-upcoming-title" title={tt('home.upcoming.title')} />
      <div id="home-upcoming-panel" ref={panelRef} tabIndex={-1} className={recoveryClass}>
        {view === 'error' ? (
          <BlockError
            title={tt('home.upcoming.loadFailed')}
            tt={tt}
            retrying={query.isFetching}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-3">
            {items.map((item) => (
              <li key={item.id}>
                <ReleaseItem item={item} titleLevel="h3" showDate />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export const HomePage = observer(function HomePage() {
  const { locale } = useStores();
  const tt: Translate = (key, vars) => t(locale.locale, key, vars);
  const today = shanghaiToday();
  const heroQuery = trpc.series.list.useQuery({
    sort: 'releaseDateDesc',
    releasedOnOrBefore: today,
    pageSize: 1,
  });
  const latestQuery = trpc.series.list.useQuery({
    sort: 'createdAtDesc',
    pageSize: 9,
  });
  const categoriesQuery = trpc.categories.list.useQuery();
  const releasesQuery = useReleasesList({ from: today, to: addCalendarDays(today, 365) });

  return (
    <PageShell>
      <PageMeta title={tt('nav.home')} description={tt('meta.home')} />
      <div className="space-y-12 md:space-y-16">
        <HomeHero
          tt={tt}
          locale={locale.locale}
          today={today}
          heroQuery={heroQuery}
          latestQuery={latestQuery}
        />
        <HomeCategories tt={tt} query={categoriesQuery} />
        <HomeLatest tt={tt} today={today} heroQuery={heroQuery} latestQuery={latestQuery} />
        <HomeUpcoming tt={tt} query={releasesQuery} />
      </div>
    </PageShell>
  );
});
