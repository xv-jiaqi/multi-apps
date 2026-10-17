import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { t, type Locale, type ReportResolveAction, type ReportStatus } from '@repo/shared';
import { Button } from '@repo/ui-web';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

function formatDateTime(value: string, locale: Locale) {
  return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

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
  resolvedAt: string | null;
  resolver: { id: string; username: string } | null;
  resolution: string | null;
  reporter: { id: string; username: string };
}

type ReportItem =
  | (ReportBase & {
      targetType: 'LISTING';
      target: {
        cardSlug: string;
        cardName?: string;
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
        cardSlug: string | null;
        cardName: string | null;
        seriesSlug: string | null;
        seriesTitle: string | null;
        authorUsername: string | null;
        excerpt: string;
      } | null;
    });

export const ReportsListPage = observer(function ReportsListPage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [statusFilter, setStatusFilter] = useState<'all' | ReportStatus>('all');
  const [statusMessage, setStatusMessage] = useState<{ id: number; text: string } | null>(null);
  const statusMessageIdRef = useRef(0);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const query = trpc.reports.list.useInfiniteQuery(
    { limit: 20, status: statusFilter === 'all' ? undefined : statusFilter },
    {
      enabled: session.isAuthenticated && session.isAdmin,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    },
  );

  const items = (query.data?.pages.flatMap((page) => page.items) ?? []) as ReportItem[];
  useEffect(() => {
    if (statusMessage) {
      statusRef.current?.focus();
    }
  }, [statusMessage?.id]);

  function handleFilterChange(next: 'all' | ReportStatus) {
    setStatusMessage(null);
    setStatusFilter(next);
  }

  return (
    <PageShell>
      <PageMeta title={tt('reports.title')} />
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
                    onClick={() => handleFilterChange(filter.key)}
                    aria-pressed={active}
                    className={`min-h-9 rounded-full px-4 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:min-h-0 sm:px-3 ${
                      active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    {tt(filter.tKey)}
                  </button>
                );
              })}
            </div>

            {statusMessage ? (
              <p
                ref={statusRef}
                role="status"
                tabIndex={-1}
                className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {statusMessage.text}
              </p>
            ) : null}

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
                  disabled={query.isFetching}
                  aria-busy={query.isFetching}
                  className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:pointer-events-none disabled:opacity-50"
                >
                  {query.isFetching ? tt('state.loading') : tt('state.retry')}
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
                    <ReportListItem
                      key={report.id}
                      report={report}
                      locale={locale.locale}
                      onResolved={(message) =>
                        setStatusMessage({ id: ++statusMessageIdRef.current, text: message })
                      }
                    />
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

function ReportListItem({
  report,
  locale,
  onResolved,
}: {
  report: ReportItem;
  locale: Locale;
  onResolved: (message: string) => void;
}) {
  const tt = (key: string) => t(locale, key);
  const [note, setNote] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [restoreRemoveFocus, setRestoreRemoveFocus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<ReportResolveAction | null>(null);
  const utils = trpc.useUtils();
  const markButtonRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmRemoveButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const reasonId = `report-reason-${report.id}`;
  const confirmMessageId = `report-confirm-${report.id}`;
  const noteId = `resolution-${report.id}`;
  const isBusy = submittingAction !== null;

  const resolveReport = trpc.reports.resolve.useMutation({
    async onSuccess(_, variables) {
      await utils.reports.list.invalidate();
      setError(null);
      setConfirmingRemove(false);
      setSubmittingAction(null);
      if (variables.action === 'MARK_RESOLVED') {
        onResolved(tt('reports.resolve.successMarked'));
      } else if (report.targetType === 'LISTING') {
        onResolved(tt('reports.resolve.successClosed'));
      } else {
        onResolved(tt('reports.resolve.successRemoved'));
      }
    },
    onError(err, variables) {
      const failedAction = variables.action;
      setSubmittingAction(null);
      setError(
        err.data?.code === 'FORBIDDEN'
          ? tt('reports.resolve.forbidden')
          : tt('reports.resolve.failed'),
      );
      window.requestAnimationFrame(() => {
        if (failedAction === 'REMOVE_TARGET') {
          confirmRemoveButtonRef.current?.focus();
        } else {
          markButtonRef.current?.focus();
        }
      });
    },
  });

  useEffect(() => {
    if (confirmingRemove) {
      cancelButtonRef.current?.focus();
    }
  }, [confirmingRemove]);

  useEffect(() => {
    if (!confirmingRemove && restoreRemoveFocus) {
      removeButtonRef.current?.focus();
      setRestoreRemoveFocus(false);
    }
  }, [confirmingRemove, restoreRemoveFocus]);

  function submit(action: ReportResolveAction) {
    setError(null);
    setSubmittingAction(action);
    resolveReport.mutate({
      id: report.id,
      action,
      resolution: note.trim() || undefined,
    });
  }

  function cancelConfirm() {
    setRestoreRemoveFocus(true);
    setConfirmingRemove(false);
  }

  return (
    <li
      aria-busy={isBusy || undefined}
      className="space-y-4 rounded-2xl border border-white/60 bg-white/70 p-5 shadow-sm backdrop-blur"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
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
              {tt(report.status === 'PENDING' ? 'reports.filterPending' : 'reports.filterResolved')}
            </span>
          </div>
          <p id={reasonId} className="text-sm text-neutral-900">
            {report.reason}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-x-2 text-xs text-neutral-500 sm:block sm:w-auto sm:text-right">
          <p>@{report.reporter.username}</p>
          <time dateTime={report.createdAt}>{formatDateTime(report.createdAt, locale)}</time>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white/80 p-4 text-sm">
        {report.target ? (
          <TargetSummary report={report} locale={locale} />
        ) : (
          <p className="text-neutral-500">{tt('reports.targetMissing')}</p>
        )}
      </div>

      <div className="space-y-3 border-t border-neutral-200 pt-4">
        {report.status === 'PENDING' ? (
          <>
            <div className="space-y-1">
              <label htmlFor={noteId} className="block text-xs font-medium text-neutral-700">
                {tt('reports.resolve.noteLabel')}
              </label>
              <textarea
                id={noteId}
                rows={2}
                maxLength={500}
                value={note}
                readOnly={isBusy}
                onChange={(event) => setNote(event.target.value)}
                placeholder={tt('reports.resolve.notePlaceholder')}
                className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm read-only:bg-neutral-50 read-only:text-neutral-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
              <p className="text-xs text-neutral-500">{note.length} / 500</p>
            </div>

            {confirmingRemove ? (
              <div
                role="alertdialog"
                aria-labelledby={reasonId}
                aria-describedby={confirmMessageId}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !isBusy) {
                    event.stopPropagation();
                    cancelConfirm();
                  }
                }}
                className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 sm:flex sm:items-center sm:justify-between sm:space-y-0 sm:gap-3"
              >
                <p id={confirmMessageId}>
                  {tt(
                    report.targetType === 'LISTING'
                      ? 'reports.resolve.confirmClose'
                      : 'reports.resolve.confirmRemove',
                  )}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    ref={confirmRemoveButtonRef}
                    type="button"
                    className="w-full bg-red-600 text-white hover:bg-red-700 sm:w-auto"
                    disabled={isBusy}
                    onClick={() => submit('REMOVE_TARGET')}
                  >
                    {submittingAction === 'REMOVE_TARGET'
                      ? tt('reports.resolve.submitting')
                      : tt(
                          report.targetType === 'LISTING'
                            ? 'reports.resolve.confirmCloseAction'
                            : 'reports.resolve.confirmRemoveAction',
                        )}
                  </Button>
                  <Button
                    ref={cancelButtonRef}
                    type="button"
                    variant="ghost"
                    className="w-full text-neutral-700 hover:bg-red-100 hover:text-neutral-900 sm:w-auto"
                    disabled={isBusy}
                    onClick={cancelConfirm}
                  >
                    {tt('reports.resolve.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                role="group"
                aria-labelledby={reasonId}
                className="flex flex-col gap-2 sm:flex-row sm:justify-end"
              >
                <Button
                  ref={markButtonRef}
                  type="button"
                  variant="outline"
                  className="h-10 w-full sm:w-auto"
                  disabled={isBusy}
                  onClick={() => submit('MARK_RESOLVED')}
                >
                  {submittingAction === 'MARK_RESOLVED'
                    ? tt('reports.resolve.submitting')
                    : tt('reports.resolve.markResolved')}
                </Button>
                {report.target ? (
                  <Button
                    ref={removeButtonRef}
                    type="button"
                    variant="outline"
                    className="h-10 w-full border-red-200 text-red-600 hover:bg-red-50 sm:w-auto"
                    disabled={isBusy}
                    onClick={() => setConfirmingRemove(true)}
                  >
                    {tt(
                      report.targetType === 'LISTING'
                        ? 'reports.resolve.closeTarget'
                        : 'reports.resolve.removeTarget',
                    )}
                  </Button>
                ) : null}
              </div>
            )}

            {error ? (
              <p
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {error}
              </p>
            ) : null}
          </>
        ) : (
          <ResolvedReportDetails report={report} locale={locale} />
        )}
      </div>
    </li>
  );
}

function ResolvedReportDetails({ report, locale }: { report: ReportItem; locale: Locale }) {
  const tt = (key: string) => t(locale, key);
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-xs">
      <dt className="whitespace-nowrap text-neutral-500">{tt('reports.resolve.resolvedBy')}</dt>
      <dd className="text-neutral-800">
        {report.resolver ? `@${report.resolver.username}` : tt('reports.resolve.deletedUser')}
      </dd>
      <dt className="whitespace-nowrap text-neutral-500">{tt('reports.resolve.resolvedAt')}</dt>
      <dd className="text-neutral-800">
        {report.resolvedAt ? (
          <time
            dateTime={report.resolvedAt}
            title={new Date(report.resolvedAt).toLocaleString(locale)}
          >
            {formatDateTime(report.resolvedAt, locale)}
          </time>
        ) : (
          '—'
        )}
      </dd>
      {report.resolution ? (
        <>
          <dt className="whitespace-nowrap text-neutral-500">{tt('reports.resolve.resolution')}</dt>
          <dd className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-neutral-800">
            {report.resolution}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function TargetSummary({ report, locale }: { report: ReportItem; locale: Locale }) {
  const tt = (key: string) => t(locale, key);

  if (report.targetType === 'LISTING' && report.target) {
    const listingIsOpen = report.target.status === 'OPEN';
    return (
      <div className="space-y-1">
        <Link
          to={`/cards/${report.target.cardSlug}`}
          className="font-medium text-brand-600 hover:underline"
        >
          {report.target.cardName ?? report.target.cardSlug}
        </Link>
        <p className="text-xs text-neutral-500">
          @{report.target.sellerUsername ?? '-'} ·{' '}
          <span className={listingIsOpen ? 'text-emerald-700' : 'text-neutral-500'}>
            {tt(listingIsOpen ? 'trade.list.statusOpen' : 'trade.list.statusClosed')}
          </span>
        </p>
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
    const targetPath = report.target.cardSlug
      ? `/cards/${report.target.cardSlug}`
      : report.target.seriesSlug
        ? `/series/${report.target.seriesSlug}`
        : null;
    const targetLabel =
      report.target.cardName ?? report.target.seriesTitle ?? tt('reports.openTarget');

    return (
      <div className="space-y-1">
        {targetPath ? (
          <Link to={targetPath} className="font-medium text-brand-600 hover:underline">
            {targetLabel}
          </Link>
        ) : (
          <p className="font-medium text-neutral-800">{targetLabel}</p>
        )}
        <p className="text-neutral-800">{report.target.excerpt}</p>
        <p className="text-xs text-neutral-500">@{report.target.authorUsername ?? '-'}</p>
      </div>
    );
  }

  return <p className="text-neutral-500">{tt('reports.targetMissing')}</p>;
}
