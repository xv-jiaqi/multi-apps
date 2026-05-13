import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Link } from 'react-router';
import { t, type Locale, type ReportStatus } from '@repo/shared';
import { Button } from '@repo/ui-web';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

const STATUS_FILTERS: Array<{ key: 'all' | ReportStatus; tKey: string }> = [
  { key: 'all', tKey: 'reports.filterAll' },
  { key: 'PENDING', tKey: 'reports.filterPending' },
  { key: 'RESOLVED', tKey: 'reports.filterResolved' },
];

interface ReportBase {
  id: string;
  targetId: string;
  reason: string;
  status: ReportStatus;
  createdAt: string;
  reporter: { id: string; username: string };
}

type ReportItem =
  | (ReportBase & {
      targetType: 'LISTING';
      target: {
        cardSlug: string;
        status: string;
        sellerUsername: string | null;
      } | null;
    })
  | (ReportBase & {
      targetType: 'TOPIC';
      target: {
        slug: string;
        title: string;
        authorUsername: string | null;
      } | null;
    })
  | (ReportBase & {
      targetType: 'REPLY';
      target: {
        topicSlug: string;
        topicTitle: string;
        authorUsername: string | null;
        excerpt: string;
      } | null;
    })
  | (ReportBase & {
      targetType: 'COMMENT';
      target: {
        cardSlug: string;
        cardName: string;
        authorUsername: string | null;
        excerpt: string;
      } | null;
    });

export const ReportsListPage = observer(function ReportsListPage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [statusFilter, setStatusFilter] = useState<'all' | ReportStatus>('all');

  const query = trpc.reports.list.useInfiniteQuery(
    { limit: 20, status: statusFilter === 'all' ? undefined : statusFilter },
    {
      enabled: session.isAuthenticated && session.isAdmin,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    },
  );

  const items = (query.data?.pages.flatMap((page) => page.items) ?? []) as ReportItem[];

  return (
    <PageShell>
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('reports.title') }]}
        />

        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{tt('reports.title')}</h1>
          <p className="text-neutral-600">{tt('reports.subtitle')}</p>
        </header>

        {!session.isAuthenticated ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            <Link
              to="/login"
              state={{ from: '/reports' }}
              className="text-brand-600 hover:underline"
            >
              {tt('reports.loginRequired')}
            </Link>
          </p>
        ) : !session.isAdmin ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {tt('reports.adminOnly')}
          </p>
        ) : (
          <>
            <div className="inline-flex rounded-full border border-neutral-200 bg-white p-1">
              {STATUS_FILTERS.map((filter) => {
                const active = filter.key === statusFilter;
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setStatusFilter(filter.key)}
                    aria-pressed={active}
                    className={`rounded-full px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    {tt(filter.tKey)}
                  </button>
                );
              })}
            </div>

            {query.isLoading ? (
              <ul className="space-y-3">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <li
                    key={idx}
                    className="h-32 animate-pulse rounded-2xl border border-white/60 bg-white/50"
                  />
                ))}
              </ul>
            ) : query.isError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
                <p className="font-medium">{tt('state.error')}</p>
                <p className="mt-1 break-all text-xs opacity-80">{query.error.message}</p>
                <button
                  type="button"
                  onClick={() => query.refetch()}
                  className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  {tt('state.retry')}
                </button>
              </div>
            ) : items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
                {tt('reports.empty')}
              </p>
            ) : (
              <>
                <ul className="space-y-3">
                  {items.map((report) => (
                    <li
                      key={report.id}
                      className="space-y-4 rounded-2xl border border-white/60 bg-white/70 p-5 shadow-sm backdrop-blur"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white">
                              {tt(`reports.target.${report.targetType.toLowerCase()}`)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                report.status === 'PENDING'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {tt(
                                report.status === 'PENDING'
                                  ? 'reports.filterPending'
                                  : 'reports.filterResolved',
                              )}
                            </span>
                          </div>
                          <p className="text-sm text-neutral-900">{report.reason}</p>
                        </div>
                        <div className="text-right text-xs text-neutral-500">
                          <p>@{report.reporter.username}</p>
                          <time dateTime={report.createdAt}>
                            {new Date(report.createdAt).toLocaleString(locale.locale)}
                          </time>
                        </div>
                      </div>

                      <div className="rounded-xl border border-neutral-200 bg-white/80 p-4 text-sm">
                        {report.target ? (
                          <TargetSummary report={report} locale={locale.locale} />
                        ) : (
                          <p className="text-neutral-500">{tt('reports.targetMissing')}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>

                {query.hasNextPage ? (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void query.fetchNextPage()}
                      disabled={query.isFetchingNextPage}
                    >
                      {query.isFetchingNextPage ? tt('state.loading') : tt('reports.loadMore')}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
});

function TargetSummary({ report, locale }: { report: ReportItem; locale: Locale }) {
  const tt = (key: string) => t(locale, key);

  if (report.targetType === 'LISTING' && report.target) {
    return (
      <div className="space-y-1">
        <Link to="/trade" className="font-medium text-brand-600 hover:underline">
          {tt('reports.openTarget')}
        </Link>
        <p className="text-neutral-800">
          {report.target.cardSlug} · @{report.target.sellerUsername ?? '-'}
        </p>
        <p className="text-xs text-neutral-500">{report.target.status}</p>
      </div>
    );
  }

  if (report.targetType === 'TOPIC' && report.target) {
    return (
      <div className="space-y-1">
        <Link
          to={`/forum/${report.target.slug}`}
          className="font-medium text-brand-600 hover:underline"
        >
          {report.target.title}
        </Link>
        <p className="text-xs text-neutral-500">@{report.target.authorUsername ?? '-'}</p>
      </div>
    );
  }

  if (report.targetType === 'REPLY' && report.target) {
    return (
      <div className="space-y-1">
        <Link
          to={`/forum/${report.target.topicSlug}`}
          className="font-medium text-brand-600 hover:underline"
        >
          {report.target.topicTitle}
        </Link>
        <p className="text-neutral-800">{report.target.excerpt}</p>
        <p className="text-xs text-neutral-500">@{report.target.authorUsername ?? '-'}</p>
      </div>
    );
  }

  if (report.targetType === 'COMMENT' && report.target) {
    return (
      <div className="space-y-1">
        <Link
          to={`/cards/${report.target.cardSlug}`}
          className="font-medium text-brand-600 hover:underline"
        >
          {report.target.cardName}
        </Link>
        <p className="text-neutral-800">{report.target.excerpt}</p>
        <p className="text-xs text-neutral-500">@{report.target.authorUsername ?? '-'}</p>
      </div>
    );
  }

  return <p className="text-neutral-500">{tt('reports.targetMissing')}</p>;
}
