import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { PageMeta } from '../components/page-meta';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { gradientFor } from '../lib/gradients';
import { useArtImage } from '../components/artwork';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { queryFallback, useFocusOnRecovery } from '../components/retry-button';

type FeaturedSeries = {
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
};

function FeaturedSeriesTile({ series, featured }: { series: FeaturedSeries; featured: boolean }) {
  const art = useArtImage({
    src: series.coverUrl,
    alt: '',
    fit: 'cover',
    priority: featured,
  });
  const hasImage = art.mode === 'image';

  return (
    <Link
      to={`/series/${series.slug}`}
      className={`group relative overflow-hidden rounded-2xl border border-white/60 bg-white/70 p-5 shadow-lg backdrop-blur-xl transition-transform hover:-translate-y-1 ${
        featured ? 'col-span-2' : ''
      }`}
    >
      {hasImage ? (
        <div className="absolute inset-0 -z-10 opacity-30">
          <img key={series.coverUrl} {...art.imgProps} />
        </div>
      ) : (
        <div
          className={`absolute inset-0 -z-10 bg-gradient-to-br ${gradientFor(series.slug)} opacity-30`}
        />
      )}
      <h3 className="text-lg font-semibold text-neutral-900">{series.title}</h3>
      <p className="mt-1 line-clamp-2 text-xs text-neutral-800">{series.description ?? ''}</p>
    </Link>
  );
}

export const HomePage = observer(function HomePage() {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const seriesQuery = trpc.series.list.useQuery();
  const view = queryFallback(seriesQuery);
  const gridRef = useRef<HTMLDivElement>(null);
  useFocusOnRecovery(view, gridRef);
  const featured = (seriesQuery.data?.items ?? []).slice(0, 3);
  const totalCards = (seriesQuery.data?.items ?? []).reduce((acc, s) => acc + s.cardCount, 0);

  return (
    <PageShell>
      <PageMeta title={tt('nav.home')} />
      <section className="grid gap-12 pb-16 pt-6 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div className="space-y-6">
          <h1 className="text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl md:text-6xl">
            {tt('welcome.title')}
          </h1>
          <p className="max-w-xl text-lg text-neutral-600">{tt('welcome.subtitle')}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="bg-brand-700 text-white hover:bg-brand-800 focus-visible:ring-brand-700"
            >
              <Link to="/series">{tt('welcome.cta.browse')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/search">{tt('welcome.cta.search')}</Link>
            </Button>
          </div>
        </div>

        <div className="relative">
          <h2 className="sr-only">{tt('series.list.title')}</h2>
          <div className="absolute -inset-6 -z-10 rounded-3xl bg-gradient-to-br from-indigo-200/60 via-fuchsia-200/40 to-amber-200/40 blur-2xl" />
          <div
            ref={gridRef}
            tabIndex={-1}
            aria-label={tt('series.list.title')}
            className={`grid grid-cols-2 gap-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              view === 'error' ? 'md:min-h-68 md:content-center' : ''
            }`}
          >
            {view === 'loading' ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className={`h-32 animate-pulse rounded-2xl border border-white/60 bg-white/50 motion-reduce:animate-none ${
                    idx === 0 ? 'col-span-2' : ''
                  }`}
                />
              ))
            ) : view === 'error' ? (
              <div className="col-span-2">
                <ErrorBox
                  title={tt('home.series.loadFailed')}
                  retryLabel={tt('state.retry')}
                  retryingLabel={tt('state.retrying')}
                  retrying={seriesQuery.isFetching}
                  retry={() => {
                    void seriesQuery.refetch();
                  }}
                  retryClassName={dataErrorRetryClassName}
                />
              </div>
            ) : (
              featured.map((series, idx) => (
                <FeaturedSeriesTile key={series.slug} series={series} featured={idx === 0} />
              ))
            )}
          </div>
        </div>
      </section>

      {view === 'error' ? null : (
        <section className="grid gap-6 pb-16 md:grid-cols-3">
          <h2 className="sr-only">{tt('home.stats.source')}</h2>
          <Card className="border-white/60 bg-white/70 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">{tt('home.stats.series')}</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold tracking-tight">
              {view === 'loading' ? (
                <>
                  <div
                    aria-hidden
                    className="h-9 w-16 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none"
                  />
                  <span className="sr-only">{tt('a11y.loading')}</span>
                </>
              ) : (
                seriesQuery.data?.total
              )}
            </CardContent>
          </Card>
          <Card className="border-white/60 bg-white/70 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">{tt('home.stats.cards')}</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold tracking-tight">
              {view === 'loading' ? (
                <>
                  <div
                    aria-hidden
                    className="h-9 w-16 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none"
                  />
                  <span className="sr-only">{tt('a11y.loading')}</span>
                </>
              ) : (
                totalCards
              )}
            </CardContent>
          </Card>
          <Card className="border-white/60 bg-white/70 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">{tt('home.stats.source')}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-neutral-600">
              {tt('home.stats.sourceNote')}
            </CardContent>
          </Card>
        </section>
      )}
    </PageShell>
  );
});
