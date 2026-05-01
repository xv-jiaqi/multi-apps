import { observer } from 'mobx-react-lite';
import { Link, useParams } from 'react-router';
import { t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { RarityBadge } from '../components/rarity-badge';
import { useStores } from '../stores/root-store';
import { getMockSeries } from '../lib/mock-data';

export const SeriesDetailPage = observer(function SeriesDetailPage() {
  const { seriesSlug = '' } = useParams<{ seriesSlug: string }>();
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const series = getMockSeries(seriesSlug);

  if (!series) {
    return (
      <PageShell>
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('breadcrumb.series'), to: '/series' },
              { label: seriesSlug },
            ]}
          />
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {tt('state.notFound')}
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="space-y-8">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('breadcrumb.series'), to: '/series' },
            { label: series.title },
          ]}
        />

        <header
          className={`relative overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-br ${series.coverGradient} p-8 text-white shadow-lg`}
        >
          <div className="absolute inset-0 bg-black/15" aria-hidden />
          <div className="relative space-y-3">
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{series.title}</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-white/90">{series.description}</p>
            <p className="text-xs uppercase tracking-widest text-white/80">
              {tt('series.cardCount', { count: series.cardCount })}
            </p>
          </div>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{tt('series.detail.cardsTitle')}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {series.cards.map((card) => (
              <li key={card.slug}>
                <Link
                  to={`/cards/${card.slug}`}
                  className="group block overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-sm backdrop-blur transition-transform hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div
                    className={`relative flex h-44 items-center justify-center bg-gradient-to-br ${card.imageGradient}`}
                    aria-hidden
                  >
                    <span className="text-3xl font-black uppercase tracking-widest text-white/70">
                      {card.name.slice(0, 1)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <span className="text-base font-semibold text-neutral-900">{card.name}</span>
                    <RarityBadge rarity={card.rarity} locale={locale.locale} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageShell>
  );
});
