import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { t } from '@repo/shared';
import { Breadcrumbs } from '../components/breadcrumbs';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { PageMeta } from '../components/page-meta';
import { PageShell } from '../components/page-shell';
import { queryFallback, useFocusOnRecovery } from '../components/retry-button';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

export const CategoryListPage = observer(function CategoryListPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const query = trpc.categories.list.useQuery();
  const view = queryFallback(query);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  useFocusOnRecovery(view, headingRef);

  return (
    <PageShell>
      <PageMeta title={tt('category.list.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('nav.categories') }]}
        />
        <header className="space-y-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {tt('category.list.title')}
          </h1>
          <p className="text-neutral-600">{tt('category.list.subtitle')}</p>
        </header>
        {view === 'loading' ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <li
                key={index}
                className="h-32 animate-pulse motion-reduce:animate-none rounded-2xl bg-white/50"
              />
            ))}
          </ul>
        ) : view === 'error' ? (
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
        ) : query.data && query.data.items.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {query.data.items.map((category) => (
              <li key={category.slug}>
                <Link
                  to={`/categories/${category.slug}`}
                  className="block rounded-2xl border border-white/60 bg-white/70 p-5 shadow-sm hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <h2 className="text-lg font-semibold text-neutral-900">{category.name}</h2>
                  {category.description ? (
                    <p className="mt-2 line-clamp-2 text-sm text-neutral-600">
                      {category.description}
                    </p>
                  ) : null}
                  <p className="mt-3 text-xs text-neutral-600">
                    {tt('category.seriesCount', { count: category.seriesCount })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-600">
            {tt('category.list.empty')}
          </p>
        )}
      </div>
    </PageShell>
  );
});
