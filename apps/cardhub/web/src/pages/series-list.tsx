import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { useStores } from '../stores/root-store';
import { listMockSeries } from '../lib/mock-data';

export const SeriesListPage = observer(function SeriesListPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const series = listMockSeries();

  return (
    <PageShell>
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('breadcrumb.series') }]}
        />
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{tt('series.list.title')}</h1>
          <p className="text-neutral-600">{tt('series.list.subtitle')}</p>
        </header>

        {series.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {tt('series.empty')}
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {series.map((s) => (
              <li key={s.slug}>
                <Link
                  to={`/series/${s.slug}`}
                  className="group block overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-sm backdrop-blur transition-transform hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className={`relative h-32 bg-gradient-to-br ${s.coverGradient}`} aria-hidden>
                    <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
                  </div>
                  <div className="space-y-2 p-5">
                    <h3 className="text-lg font-semibold text-neutral-900">{s.title}</h3>
                    <p className="line-clamp-2 text-sm text-neutral-600">{s.description}</p>
                    <p className="text-xs text-neutral-500">
                      {tt('series.cardCount', { count: s.cardCount })}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
});
