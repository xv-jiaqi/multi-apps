import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { appErrorMessage, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { Artwork } from '../components/artwork';

export const SeriesListPage = observer(function SeriesListPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const query = trpc.series.list.useQuery();

  return (
    <PageShell>
      <PageMeta title={tt('series.list.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('breadcrumb.series') }]}
        />
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{tt('series.list.title')}</h1>
          <p className="text-neutral-600">{tt('series.list.subtitle')}</p>
        </header>

        {query.isLoading ? (
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <li
                key={idx}
                className="h-56 animate-pulse rounded-2xl border border-white/60 bg-white/50"
              />
            ))}
          </ul>
        ) : query.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            <p className="font-medium">{tt('state.error')}</p>
            <p className="mt-1 break-all text-xs opacity-80">
              {appErrorMessage(locale.locale, query.error.data?.appCode)}
            </p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              {tt('state.retry')}
            </button>
          </div>
        ) : query.data && query.data.items.length > 0 ? (
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {query.data.items.map((s) => (
              <li key={s.slug}>
                <Link
                  to={`/series/${s.slug}`}
                  className="group block overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-sm backdrop-blur transition-transform hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="relative" aria-hidden>
                    <Artwork
                      kind="series"
                      src={s.coverUrl}
                      slug={s.slug}
                      name={s.title}
                      decorative
                      className="w-full"
                    />
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
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {tt('series.empty')}
          </p>
        )}
      </div>
    </PageShell>
  );
});
