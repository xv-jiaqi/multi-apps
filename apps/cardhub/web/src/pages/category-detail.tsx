import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Link, useParams } from 'react-router';
import { t } from '@repo/shared';
import { Artwork } from '../components/artwork';
import { Breadcrumbs } from '../components/breadcrumbs';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { PageMeta } from '../components/page-meta';
import { PageShell } from '../components/page-shell';
import { queryFallback, useFocusOnRecovery } from '../components/retry-button';
import { formatCatalogDate } from '../lib/catalog-taxonomy';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

export const CategoryDetailPage = observer(function CategoryDetailPage() {
  const { slug = '' } = useParams();
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const query = trpc.categories.bySlug.useQuery({ slug }, { enabled: Boolean(slug) });
  const view = queryFallback(query);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  useFocusOnRecovery(view, headingRef);
  const notFound = view === 'error' && query.error?.data?.code === 'NOT_FOUND';

  return (
    <PageShell>
      <PageMeta title={query.data?.name ?? tt('nav.categories')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={
            query.data
              ? [
                  { label: tt('breadcrumb.home'), to: '/' },
                  { label: tt('nav.categories'), to: '/categories' },
                  { label: query.data.name },
                ]
              : [{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('nav.categories') }]
          }
        />
        {view === 'loading' ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="h-9 w-48 animate-pulse motion-reduce:animate-none rounded bg-white/50" />
              <div className="h-4 max-w-2xl animate-pulse motion-reduce:animate-none rounded bg-white/50" />
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <li
                  key={index}
                  className="h-56 animate-pulse motion-reduce:animate-none rounded-2xl bg-white/50"
                />
              ))}
            </ul>
          </div>
        ) : notFound ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-600">
            {tt('state.notFound')}
          </p>
        ) : view === 'error' || !query.data ? (
          <ErrorBox
            title={tt('state.error')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={query.isFetching}
            retry={() => {
              void query.refetch();
            }}
            retryClassName={dataErrorRetryClassName}
            retryRef={retryRef}
          />
        ) : (
          <>
            <header className="space-y-2">
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-3xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {query.data.name}
              </h1>
              {query.data.description ? (
                <p className="max-w-2xl text-neutral-600">{query.data.description}</p>
              ) : null}
            </header>
            {query.data.series.length > 0 ? (
              <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {query.data.series.map((series) => (
                  <li key={series.slug}>
                    <Link
                      to={`/series/${series.slug}`}
                      className="group block overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-sm backdrop-blur transition-transform hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
                        <h2 className="text-lg font-semibold text-neutral-900">{series.title}</h2>
                        {series.description ? (
                          <p className="line-clamp-2 text-sm text-neutral-600">
                            {series.description}
                          </p>
                        ) : null}
                        <p className="text-xs text-neutral-600">
                          {tt('series.cardCount', { count: series.cardCount })}
                        </p>
                        {series.releaseDate ? (
                          <p className="text-xs text-neutral-600">
                            <time dateTime={series.releaseDate}>
                              {tt('series.releaseDate', {
                                date: formatCatalogDate(locale.locale, series.releaseDate),
                              })}
                            </time>
                          </p>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-600">
                {tt('category.detail.empty')}
              </p>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
});
