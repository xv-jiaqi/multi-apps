import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { APP_NAME, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { gradientFor } from '../lib/gradients';
import { useArtImage } from '../components/artwork';

type FeaturedSeries = {
  slug: string;
  title: string;
  description: string;
  coverUrl: string;
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
          className={`absolute inset-0 -z-10 bg-gradient-to-br ${gradientFor(series.slug)} opacity-30 transition-opacity group-hover:opacity-50`}
        />
      )}
      <h3 className="text-lg font-semibold text-neutral-900">{series.title}</h3>
      <p className="mt-1 line-clamp-2 text-xs text-neutral-700">{series.description}</p>
    </Link>
  );
}

export const HomePage = observer(function HomePage() {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const seriesQuery = trpc.series.list.useQuery();
  const featured = (seriesQuery.data?.items ?? []).slice(0, 3);
  const totalCards = (seriesQuery.data?.items ?? []).reduce((acc, s) => acc + s.cardCount, 0);

  return (
    <PageShell>
      <section className="grid gap-12 pb-16 pt-6 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div className="space-y-6">
          <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white/70 px-3 py-1 text-xs font-medium text-neutral-600 backdrop-blur">
            {APP_NAME} · MVP
          </span>
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
          <div className="grid grid-cols-2 gap-4">
            {seriesQuery.isLoading
              ? Array.from({ length: 3 }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-32 animate-pulse rounded-2xl border border-white/60 bg-white/50 ${
                      idx === 0 ? 'col-span-2' : ''
                    }`}
                  />
                ))
              : featured.map((series, idx) => (
                  <FeaturedSeriesTile
                    key={series.slug}
                    series={series}
                    featured={idx === 0}
                  />
                ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 pb-16 md:grid-cols-3">
        <h2 className="sr-only">{tt('home.stats.source')}</h2>
        <Card className="border-white/60 bg-white/70 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-base">{tt('home.stats.series')}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold tracking-tight">
            {seriesQuery.data?.total ?? '—'}
          </CardContent>
        </Card>
        <Card className="border-white/60 bg-white/70 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-base">{tt('home.stats.cards')}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold tracking-tight">
            {seriesQuery.data ? totalCards : '—'}
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
    </PageShell>
  );
});
