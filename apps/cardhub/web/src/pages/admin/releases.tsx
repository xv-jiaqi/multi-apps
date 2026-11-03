import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { t, type ReleaseRegionValue } from '@repo/shared';
import { Button } from '@repo/ui-web';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import { DeleteReleaseDialog } from '../../components/admin/delete-release-dialog';
import {
  AdminEmpty,
  AdminErrorBox,
  AdminStatus,
  AdminTable,
  AdminTableHead,
  AdminTh,
  actionClass,
} from '../../components/admin/admin-table';
import { isAccessRevoked } from '../../components/admin/catalog-utils';
import { useAdminNotice } from '../../components/admin/use-admin-notice';
import { queryFallback, useFocusOnRecovery } from '../../components/retry-button';
import { releaseNotFound, releaseWriteFeedback } from '../../lib/release-form';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';

const LIST_INPUT = { limit: 50 } as const;

type ReleaseRow = {
  id: string;
  title: string;
  releaseDate: string;
  datePrecision: 'DAY' | 'MONTH';
  region: ReleaseRegionValue | null;
  series: { slug: string; title: string } | null;
};

function dateLabel(row: ReleaseRow): string {
  if (row.datePrecision === 'MONTH') return row.releaseDate.slice(0, 7);
  return row.releaseDate;
}

export const AdminReleasesPage = observer(function AdminReleasesPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  return (
    <PageShell>
      <PageMeta title={tt('admin.releases.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('nav.admin') },
            { label: tt('nav.releases') },
          ]}
        />
        <AdminGate>
          <AdminReleasesBody />
        </AdminGate>
      </div>
    </PageShell>
  );
});

const AdminReleasesBody = observer(function AdminReleasesBody() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const { notice, statusRef } = useAdminNotice();
  const utils = trpc.useUtils();
  const query = trpc.admin.releases.list.useInfiniteQuery(LIST_INPUT, {
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const remove = trpc.admin.releases.delete.useMutation();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<ReleaseRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const createRef = useRef<HTMLAnchorElement>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusId = useRef<string | null>(null);
  const items = (query.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (item) => !removed.has(item.id),
  );
  const listView = queryFallback(query);
  const revoked = query.isError && isAccessRevoked(query.error);
  useFocusOnRecovery(listView, titleRef);

  useEffect(() => {
    if (revoked) reportForbidden();
  }, [reportForbidden, revoked]);

  const closeDialog = (nextFocus: string | null) => {
    focusId.current = nextFocus;
    setDeleting(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!deleting || remove.isPending) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync({ id: deleting.id });
    } catch (error) {
      if (releaseNotFound(error)) {
        // Already gone. Treat the row as deleted.
      } else if (isAccessRevoked(error)) {
        reportForbidden();
        closeDialog(null);
        return;
      } else {
        const feedback = releaseWriteFeedback(locale.locale, error);
        setDeleteError(feedback.message ?? tt('admin.deleteFailed'));
        return;
      }
    }
    const remaining = items.filter((item) => item.id !== deleting.id);
    setRemoved((current) => new Set(current).add(deleting.id));
    void utils.admin.releases.list.invalidate();
    void utils.releases.list.invalidate();
    closeDialog(remaining[0]?.id ?? 'create');
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1
          id="admin-releases-title"
          ref={titleRef}
          tabIndex={-1}
          className="text-3xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {tt('admin.releases.title')}
        </h1>
        <Button asChild>
          <Link ref={createRef} to="/admin/releases/new">
            {tt('admin.releases.new')}
          </Link>
        </Button>
      </header>
      <AdminStatus message={notice} statusRef={statusRef} />
      {listView === 'error' && !query.data ? (
        revoked ? null : (
          <AdminErrorBox
            title={tt('admin.releases.loadError')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
          />
        )
      ) : listView === 'loading' ? (
        <AdminTable caption={tt('admin.releases.title')} busy contained>
          <AdminTableHead>
            <AdminTh className="whitespace-normal">{tt('admin.releases.col.date')}</AdminTh>
            <AdminTh className="whitespace-normal">{tt('admin.col.title')}</AdminTh>
            <AdminTh className="whitespace-normal">{tt('admin.releases.col.region')}</AdminTh>
            <AdminTh className="whitespace-normal">{tt('admin.releases.col.series')}</AdminTh>
            <AdminTh className="whitespace-normal">{tt('admin.col.actions')}</AdminTh>
          </AdminTableHead>
          <tbody>
            {Array.from({ length: 4 }, (_, row) => (
              <tr key={row}>
                {Array.from({ length: 5 }, (_, cell) => (
                  <td key={cell} className="px-3 py-3">
                    <span className="block h-4 animate-pulse motion-reduce:animate-none rounded bg-neutral-200" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </AdminTable>
      ) : items.length === 0 && !query.hasNextPage ? (
        <AdminEmpty>{tt('admin.releases.empty')}</AdminEmpty>
      ) : (
        <>
          <AdminTable caption={tt('admin.releases.title')} labelledBy="admin-releases-title">
            <AdminTableHead>
              <AdminTh>{tt('admin.releases.col.date')}</AdminTh>
              <AdminTh>{tt('admin.col.title')}</AdminTh>
              <AdminTh>{tt('admin.releases.col.region')}</AdminTh>
              <AdminTh>{tt('admin.releases.col.series')}</AdminTh>
              <AdminTh>{tt('admin.col.actions')}</AdminTh>
            </AdminTableHead>
            <tbody className="divide-y divide-neutral-200">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-neutral-900">
                    {dateLabel(item)}
                  </td>
                  <td className="px-3 py-2 font-medium text-neutral-900 wrap-anywhere">
                    {item.title}
                  </td>
                  <td className="px-3 py-2 text-neutral-800">
                    {item.region ? tt(`region.${item.region}`) : ''}
                  </td>
                  <td className="px-3 py-2">
                    {item.series ? (
                      <Link
                        to={`/series/${item.series.slug}`}
                        className={`${actionClass} text-link hover:underline wrap-anywhere`}
                      >
                        {item.series.title}
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/admin/releases/${item.id}/edit`}
                        className={`${actionClass} text-link hover:underline`}
                        aria-label={tt('admin.action.editAria', { name: item.title })}
                      >
                        {tt('admin.action.edit')}
                      </Link>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-6"
                        aria-label={tt('admin.action.deleteAria', { name: item.title })}
                        ref={(node) => {
                          if (node) deleteRefs.current.set(item.id, node);
                          else deleteRefs.current.delete(item.id);
                        }}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(item);
                        }}
                      >
                        {tt('admin.action.delete')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
          {query.isFetchNextPageError ? (
            <AdminErrorBox
              title={tt('admin.releases.loadError')}
              onRetry={() => void query.fetchNextPage()}
              retrying={query.isFetchingNextPage}
              retryLabel={tt('state.retry')}
              retryingLabel={tt('state.retrying')}
            />
          ) : query.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                aria-disabled={query.isFetchingNextPage || undefined}
                aria-busy={query.isFetchingNextPage || undefined}
                onClick={() => {
                  if (query.isFetchingNextPage) return;
                  void query.fetchNextPage();
                }}
              >
                {query.isFetchingNextPage ? tt('state.loading') : tt('me.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
      <DeleteReleaseDialog
        release={deleting}
        busy={remove.isPending}
        error={deleteError}
        onOpenChange={(open) => {
          if (open || focusId.current) return;
          closeDialog(deleting?.id ?? null);
        }}
        onConfirm={() => void confirmDelete()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = focusId.current;
          focusId.current = null;
          if (target === 'create') {
            createRef.current?.focus();
            return;
          }
          if (target) deleteRefs.current.get(target)?.focus();
        }}
      />
    </div>
  );
});
