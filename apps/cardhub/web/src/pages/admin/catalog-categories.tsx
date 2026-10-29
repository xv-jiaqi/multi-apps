import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { t } from '@repo/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@repo/ui-web';
import { CatalogTabs } from '../../components/admin/catalog-tabs';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import {
  AdminEmpty,
  AdminErrorBox,
  AdminTable,
  AdminTableHead,
  AdminTh,
  actionClass,
} from '../../components/admin/admin-table';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import { queryFallback, useFocusOnRecovery } from '../../components/retry-button';
import {
  failureText,
  isAccessRevoked,
  readTrpcFailure,
} from '../../components/admin/catalog-utils';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';

export const CatalogCategoriesPage = observer(function CatalogCategoriesPage() {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  return (
    <PageShell>
      <PageMeta title={tt('admin.catalog.categoriesTab')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('nav.admin') },
            { label: tt('nav.catalog'), to: '/admin/catalog' },
            { label: tt('admin.catalog.categoriesTab') },
          ]}
        />
        <AdminGate>
          <CatalogCategoriesBody />
        </AdminGate>
      </div>
    </PageShell>
  );
});

const CatalogCategoriesBody = observer(function CatalogCategoriesBody() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const utils = trpc.useUtils();
  const query = trpc.admin.categories.list.useQuery();
  const remove = trpc.admin.categories.delete.useMutation();
  const [pending, setPending] = useState<{ slug: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const view = queryFallback(query);
  useFocusOnRecovery(view, headingRef);
  const revoked = query.isError && isAccessRevoked(query.error);

  useEffect(() => {
    if (revoked) reportForbidden();
  }, [reportForbidden, revoked]);

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      await remove.mutateAsync({ slug: pending.slug });
      await utils.admin.categories.list.invalidate();
      await utils.categories.list.invalidate();
      setPending(null);
    } catch (caught) {
      if (readTrpcFailure(caught).trpcCode === 'FORBIDDEN') {
        setError(tt('error.app.FORBIDDEN'));
        actionRef.current?.focus();
        return;
      }
      setError(failureText(locale.locale, caught, 'admin.deleteFailed'));
      actionRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <CatalogTabs />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {tt('admin.catalog.categoriesTab')}
        </h1>
        <Button asChild>
          <Link to="/admin/catalog/categories/new">{tt('admin.category.new')}</Link>
        </Button>
      </header>
      {view === 'error' ? (
        revoked ? null : (
          <AdminErrorBox
            title={tt('state.error')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
          />
        )
      ) : view === 'loading' ? (
        <ul className="space-y-2">
          {Array.from({ length: 3 }, (_, index) => (
            <li
              key={index}
              className="h-12 animate-pulse motion-reduce:animate-none rounded-lg bg-white/60"
            />
          ))}
        </ul>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <AdminEmpty>{tt('admin.category.empty')}</AdminEmpty>
      ) : (
        <AdminTable caption={tt('admin.catalog.categoriesTab')}>
          <AdminTableHead>
            <AdminTh>{tt('admin.field.name')}</AdminTh>
            <AdminTh>{tt('admin.field.slug')}</AdminTh>
            <AdminTh align="right">{tt('admin.catalog.seriesTab')}</AdminTh>
            <AdminTh align="right">{tt('admin.field.sortOrder')}</AdminTh>
            <AdminTh align="right">{tt('admin.col.actions')}</AdminTh>
          </AdminTableHead>
          <tbody className="divide-y divide-neutral-200">
            {query.data?.items.map((category) => (
              <tr key={category.slug}>
                <td className="px-3 py-2 text-neutral-900">{category.name}</td>
                <td className="px-3 py-2 font-mono text-sm text-neutral-700">{category.slug}</td>
                <td className="px-3 py-2 text-right tabular-nums">{category.seriesCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{category.sortOrder}</td>
                <td className="px-3 py-2 text-right">
                  <Link
                    to={`/admin/catalog/categories/${category.slug}/edit`}
                    className={actionClass}
                  >
                    {tt('admin.action.edit')}
                  </Link>
                  <button
                    type="button"
                    className={`${actionClass} text-red-700`}
                    onClick={() => setPending({ slug: category.slug, name: category.name })}
                  >
                    {tt('admin.action.delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (busy || open) return;
          setPending(null);
          setError(null);
        }}
      >
        <AlertDialogContent variant="destructive">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tt('admin.category.deleteTitle', { name: pending?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{tt('admin.category.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{tt('admin.cancel')}</AlertDialogCancel>
            <Button
              ref={actionRef}
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? tt('admin.deleting') : tt('admin.action.delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
