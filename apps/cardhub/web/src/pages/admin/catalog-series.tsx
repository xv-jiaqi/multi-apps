import { observer } from 'mobx-react-lite';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { t } from '@repo/shared';
import { Button, cn } from '@repo/ui-web';
import { ART_ASPECT } from '../../components/artwork';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import { queryFallback, useFocusOnRecovery } from '../../components/retry-button';
import {
  AdminConfirmRow,
  AdminEmpty,
  AdminErrorBox,
  AdminStatus,
  AdminTable,
  AdminTableHead,
  AdminTh,
  actionClass,
} from '../../components/admin/admin-table';
import { DeleteSeriesDialog } from '../../components/admin/delete-series-dialog';
import {
  failureText,
  formatAdminCount,
  formatUpdatedAt,
  isAccessRevoked,
  isSeriesHasCards,
  type AdminSeriesItem,
} from '../../components/admin/catalog-utils';
import { useAdminNotice } from '../../components/admin/use-admin-notice';
import { gradientFor } from '../../lib/gradients';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';

const COLUMNS = 6;

export const CatalogSeriesPage = observer(function CatalogSeriesPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  return (
    <PageShell>
      <PageMeta title={tt('admin.catalog.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('nav.admin') },
            { label: tt('nav.catalog') },
          ]}
        />
        <AdminGate>
          <CatalogSeriesBody />
        </AdminGate>
      </div>
    </PageShell>
  );
});

const CatalogSeriesBody = observer(function CatalogSeriesBody() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const { notice, setNotice, statusRef } = useAdminNotice();
  const utils = trpc.useUtils();
  const query = trpc.admin.series.list.useQuery();
  const remove = trpc.admin.series.delete.useMutation();
  const [confirmingSlug, setConfirmingSlug] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ slug: string; message: string } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [force, setForce] = useState<AdminSeriesItem | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusDeleteSlug = useRef<string | null>(null);
  const focusNoticeOnClose = useRef(false);
  const items = ((query.data?.items ?? []) as AdminSeriesItem[]).filter(
    (series) => !hidden.has(series.slug),
  );
  const revoked = query.isError && isAccessRevoked(query.error);
  const listView = queryFallback(query);
  useFocusOnRecovery(listView, titleRef);

  useEffect(() => {
    if (revoked) reportForbidden();
  }, [revoked, reportForbidden]);

  useEffect(() => {
    if (confirmingSlug || !focusDeleteSlug.current) return;
    const slug = focusDeleteSlug.current;
    focusDeleteSlug.current = null;
    deleteRefs.current.get(slug)?.focus();
  }, [confirmingSlug]);

  const hideSeries = (slug: string) => {
    setHidden((current) => new Set(current).add(slug));
    void utils.admin.series.list.invalidate();
    void utils.series.list.invalidate();
  };

  const confirmInline = async (series: AdminSeriesItem, reason?: string) => {
    setRowError(null);
    setPendingSlug(series.slug);
    try {
      await remove.mutateAsync(
        reason ? { slug: series.slug, force: false, reason } : { slug: series.slug, force: false },
      );
      hideSeries(series.slug);
      setConfirmingSlug(null);
      setNotice(tt('admin.series.deleted', { title: series.title }));
    } catch (error) {
      const details = isSeriesHasCards(error);
      if (details) {
        setConfirmingSlug(null);
        setForce({
          ...series,
          cardCount: details.cardCount ?? series.cardCount,
          commentCount: details.commentCount ?? series.commentCount,
        });
        return;
      }
      if (isAccessRevoked(error)) {
        reportForbidden();
        return;
      }
      setRowError({
        slug: series.slug,
        message: failureText(locale.locale, error, 'admin.deleteFailed'),
      });
    } finally {
      setPendingSlug(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="text-2xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {tt('admin.catalog.title')}
          </h1>
          <p className="text-sm text-neutral-600">{tt('admin.catalog.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/admin/catalog/import">{tt('admin.series.import')}</Link>
          </Button>
          <Button asChild>
            <Link to="/admin/catalog/series/new">{tt('admin.series.new')}</Link>
          </Button>
        </div>
      </header>
      <AdminStatus message={notice} statusRef={statusRef} />
      {listView === 'error' ? (
        revoked ? null : (
          <AdminErrorBox
            title={tt('state.error')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
          />
        )
      ) : listView === 'loading' ? (
        <AdminTable caption={tt('admin.series.caption')} busy>
          <AdminTableHead>
            <AdminTh>{tt('admin.col.cover')}</AdminTh>
            <AdminTh>{tt('admin.col.title')}</AdminTh>
            <AdminTh>{tt('admin.col.slug')}</AdminTh>
            <AdminTh align="right">{tt('admin.col.cards')}</AdminTh>
            <AdminTh>{tt('admin.col.updated')}</AdminTh>
            <AdminTh align="right">{tt('admin.col.actions')}</AdminTh>
          </AdminTableHead>
          <tbody className="divide-y divide-neutral-200">
            {Array.from({ length: 5 }, (_, index) => (
              <tr key={index}>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'block w-16 animate-pulse motion-reduce:animate-none rounded-sm bg-neutral-200',
                      ART_ASPECT.series,
                    )}
                  />
                </td>
                {Array.from({ length: 5 }, (_, cell) => (
                  <td key={cell} className="px-3 py-2">
                    <span className="block h-4 animate-pulse motion-reduce:animate-none rounded bg-neutral-200" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </AdminTable>
      ) : items.length === 0 ? (
        <AdminEmpty>
          <p>{tt('admin.series.empty')}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button asChild>
              <Link to="/admin/catalog/series/new">{tt('admin.series.new')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin/catalog/import">{tt('admin.series.import')}</Link>
            </Button>
          </div>
        </AdminEmpty>
      ) : (
        <AdminTable caption={tt('admin.series.caption')}>
          <AdminTableHead>
            <AdminTh>{tt('admin.col.cover')}</AdminTh>
            <AdminTh>{tt('admin.col.title')}</AdminTh>
            <AdminTh>{tt('admin.col.slug')}</AdminTh>
            <AdminTh align="right">{tt('admin.col.cards')}</AdminTh>
            <AdminTh>{tt('admin.col.updated')}</AdminTh>
            <AdminTh align="right">{tt('admin.col.actions')}</AdminTh>
          </AdminTableHead>
          <tbody className="divide-y divide-neutral-200">
            {items.map((series) => {
              const confirming = confirmingSlug === series.slug;
              return (
                <Fragment key={series.slug}>
                  <tr className="hover:bg-neutral-50">
                    <td className="px-3 py-2 align-middle">
                      <SeriesCover slug={series.slug} coverUrl={series.coverUrl} />
                    </td>
                    <th
                      scope="row"
                      className="px-3 py-2 text-left align-middle font-medium text-neutral-900"
                    >
                      <Link to={`/admin/catalog/series/${series.slug}`} className="hover:underline">
                        {series.title}
                      </Link>
                    </th>
                    <td className="px-3 py-2 align-middle font-mono text-xs text-neutral-600">
                      {series.slug}
                    </td>
                    <td className="px-3 py-2 text-right align-middle tabular-nums">
                      {series.cardCount}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-middle text-neutral-700">
                      <time dateTime={series.updatedAt}>
                        {formatUpdatedAt(series.updatedAt, locale.locale)}
                      </time>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
                      {confirming ? null : (
                        <div className="inline-flex items-center gap-3">
                          <Link
                            to={`/admin/catalog/series/${series.slug}/edit`}
                            aria-label={tt('admin.action.editAria', { name: series.title })}
                            className={`${actionClass} text-xs font-medium text-brand-600 hover:underline`}
                          >
                            {tt('admin.action.edit')}
                          </Link>
                          <a
                            href={`/series/${series.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={tt('admin.action.viewAria', { name: series.title })}
                            className={`${actionClass} text-xs text-neutral-600 hover:underline`}
                          >
                            {tt('admin.action.view')}
                          </a>
                          <button
                            type="button"
                            ref={(node) => {
                              if (node) deleteRefs.current.set(series.slug, node);
                              else deleteRefs.current.delete(series.slug);
                            }}
                            aria-label={tt('admin.action.deleteAria', { name: series.title })}
                            onClick={() => {
                              setNotice(null);
                              setRowError(null);
                              if (series.cardCount > 0 || series.commentCount > 0) {
                                setConfirmingSlug(null);
                                setForce(series);
                                return;
                              }
                              setForce(null);
                              setConfirmingSlug(series.slug);
                            }}
                            className={`${actionClass} text-xs text-red-700 hover:underline`}
                          >
                            {tt('admin.action.delete')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {confirming ? (
                    <AdminConfirmRow
                      colSpan={COLUMNS}
                      label={tt('admin.series.confirmDelete', { title: series.title })}
                      confirmLabel={
                        pendingSlug === series.slug
                          ? tt('admin.deleting')
                          : tt('admin.action.delete')
                      }
                      cancelLabel={tt('admin.cancel')}
                      disabled={pendingSlug === series.slug}
                      askReason
                      onConfirm={(reason) => void confirmInline(series, reason)}
                      onCancel={() => {
                        focusDeleteSlug.current = series.slug;
                        setConfirmingSlug(null);
                        setRowError(null);
                      }}
                    />
                  ) : null}
                  {rowError?.slug === series.slug ? (
                    <tr>
                      <td colSpan={COLUMNS} className="px-3 pb-2">
                        <p
                          role="alert"
                          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                        >
                          {rowError.message}
                        </p>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </AdminTable>
      )}
      <DeleteSeriesDialog
        series={force}
        onOpenChange={(open) => {
          if (!open) setForce(null);
        }}
        onForbidden={reportForbidden}
        onCloseAutoFocus={(event) => {
          if (!focusNoticeOnClose.current) return;
          event.preventDefault();
          focusNoticeOnClose.current = false;
          statusRef.current?.focus();
        }}
        onConfirm={async (reason) => {
          if (!force) return;
          const result = await remove.mutateAsync(
            reason ? { slug: force.slug, force: true, reason } : { slug: force.slug, force: true },
          );
          hideSeries(force.slug);
          const cards = result.cardCount ?? force.cardCount;
          focusNoticeOnClose.current = true;
          setNotice(
            cards > 0
              ? tt('admin.series.deletedWithCards', {
                  title: force.title,
                  cards: formatAdminCount(locale.locale, 'cards', cards),
                })
              : tt('admin.series.deleted', { title: force.title }),
          );
        }}
      />
    </div>
  );
});

function SeriesCover({ slug, coverUrl }: { slug: string; coverUrl: string | null }) {
  const trimmed = coverUrl?.trim() ?? '';
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const https = trimmed.startsWith('https://');
  const failed = https && failedSrc === trimmed;
  return (
    <span
      className={cn(
        'relative block w-16 overflow-hidden rounded-sm bg-neutral-100 ring-1 ring-black/5',
        ART_ASPECT.series,
      )}
    >
      {https && !failed ? (
        <img
          src={trimmed}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailedSrc(trimmed)}
        />
      ) : (
        <span aria-hidden className={cn('absolute inset-0 bg-gradient-to-br', gradientFor(slug))} />
      )}
    </span>
  );
}
