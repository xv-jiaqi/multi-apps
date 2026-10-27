import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { AUDIT_ACTION_VALUES, t, type AuditAction } from '@repo/shared';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui-web';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import {
  AdminEmpty,
  AdminErrorBox,
  AdminTable,
  AdminTableHead,
  AdminTh,
  actionClass,
} from '../../components/admin/admin-table';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';

const PAGE_SIZE = 50;
const SNAPSHOT_CHARS = 40;

const TARGET_TYPES = [
  'USER',
  'TOPIC',
  'REPLY',
  'COMMENT',
  'LISTING',
  'CARD',
  'SERIES',
  'REPORT',
] as const;

type TargetType = (typeof TARGET_TYPES)[number];

export interface AuditRow {
  id: string;
  createdAt: string;
  action: string;
  actorId: string | null;
  actorUsername: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  targetUserId: string | null;
  targetUsername: string | null;
  reason: string | null;
}

interface AuditPage {
  items: AuditRow[];
  total: number;
  nextCursor: string | null;
}

function parseAction(value: string | null): AuditAction | 'any' {
  if (value && (AUDIT_ACTION_VALUES as readonly string[]).includes(value)) {
    return value as AuditAction;
  }
  return 'any';
}

function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

function snapshotText(value: string): string {
  const chars = Array.from(value);
  if (chars.length <= SNAPSHOT_CHARS) return value;
  return `${chars.slice(0, SNAPSHOT_CHARS).join('')}…`;
}

function readTrpcCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined;
  const data = error.data;
  if (typeof data !== 'object' || data === null) return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export const AdminAuditPage = observer(function AdminAuditPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  return (
    <PageShell>
      <PageMeta title={tt('admin.audit.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('nav.admin') },
            { label: tt('nav.audit') },
          ]}
        />
        <AdminGate>
          <AuditBody />
        </AdminGate>
      </div>
    </PageShell>
  );
});

const AuditBody = observer(function AuditBody() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const [searchParams, setSearchParams] = useSearchParams();
  const action = parseAction(searchParams.get('action'));
  const userParam = (searchParams.get('user') ?? '').trim();
  const selectRef = useRef<HTMLButtonElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const listInput = useMemo(
    () => ({
      limit: PAGE_SIZE,
      ...(action === 'any' ? {} : { action }),
      ...(userParam ? { user: userParam } : {}),
    }),
    [action, userParam],
  );

  const query = trpc.admin.audit.list.useInfiniteQuery(listInput, {
    getNextPageParam: (last: AuditPage) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filtering = action !== 'any' || userParam.length > 0;
  const revoked =
    query.isError && !query.isFetchingNextPage && readTrpcCode(query.error) === 'FORBIDDEN';
  const empty = !query.isLoading && !query.isError && items.length === 0;

  useEffect(() => {
    if (revoked) reportForbidden();
  }, [reportForbidden, revoked]);

  const setAction = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (parseAction(next) === 'any') params.delete('action');
    else params.set('action', next);
    setSearchParams(params, { replace: true });
  };

  const clearUser = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('user');
    setSearchParams(params, { replace: true });
    window.requestAnimationFrame(() => selectRef.current?.focus());
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
    window.requestAnimationFrame(() => selectRef.current?.focus());
  };

  const onLoadMore = async () => {
    const before = items.length;
    const result = await query.fetchNextPage();
    if (result.isError) return;
    const nextItems = result.data?.pages.flatMap((page) => page.items) ?? [];
    const firstNew = nextItems[before];
    window.requestAnimationFrame(() => {
      if (result.hasNextPage) loadMoreRef.current?.focus();
      else if (firstNew) rowRefs.current.get(firstNew.id)?.focus();
    });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1
          tabIndex={-1}
          className="text-2xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {tt('admin.audit.title')}
        </h1>
        <p className="text-sm text-neutral-600">{tt('admin.audit.subtitle')}</p>
      </header>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:w-48">
          <label htmlFor="admin-audit-action" className="sr-only">
            {tt('admin.audit.filterLabel')}
          </label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger ref={selectRef} id="admin-audit-action" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{tt('admin.audit.filterAll')}</SelectItem>
              {AUDIT_ACTION_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {tt(`admin.audit.action.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {userParam ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
            {tt('admin.audit.userFilter', { user: userParam })}
            <button
              type="button"
              aria-label={tt('admin.audit.clearUser')}
              onClick={clearUser}
              className={actionClass}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ) : null}
      </div>
      {revoked ? null : query.isError && !query.data ? (
        <AdminErrorBox
          title={tt('state.error')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          retryLabel={tt('state.retry')}
          retryingLabel={tt('state.retrying')}
        />
      ) : empty && !filtering ? (
        <AdminEmpty>{tt('admin.audit.empty')}</AdminEmpty>
      ) : (
        <>
          <AdminTable caption={tt('admin.audit.caption')} busy={query.isLoading}>
            <AdminTableHead>
              <AdminTh>{tt('admin.audit.colTime')}</AdminTh>
              <AdminTh>{tt('admin.audit.colActor')}</AdminTh>
              <AdminTh>{tt('admin.audit.colAction')}</AdminTh>
              <AdminTh>{tt('admin.audit.colTarget')}</AdminTh>
              <AdminTh>{tt('admin.audit.colReason')}</AdminTh>
            </AdminTableHead>
            <tbody className="divide-y divide-neutral-200">
              {query.isLoading
                ? Array.from({ length: 5 }, (_, index) => (
                    <tr key={index}>
                      {Array.from({ length: 5 }, (_, cell) => (
                        <td key={cell} className="px-3 py-2">
                          <span className="block h-4 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none" />
                        </td>
                      ))}
                    </tr>
                  ))
                : null}
              {empty && filtering ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-neutral-600">
                    {tt('admin.audit.noMatch')}{' '}
                    <button
                      type="button"
                      onClick={clearFilters}
                      className={`${actionClass} text-brand-600 hover:underline`}
                    >
                      {tt('admin.users.clearFilters')}
                    </button>
                  </td>
                </tr>
              ) : null}
              {items.map((row) => {
                const when = new Date(row.createdAt).toLocaleString(locale.locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                });
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-neutral-700">
                      <time
                        dateTime={row.createdAt}
                        tabIndex={-1}
                        ref={(node) => {
                          if (node) rowRefs.current.set(row.id, node);
                          else rowRefs.current.delete(row.id);
                        }}
                        className="whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        {when}
                      </time>
                    </td>
                    <td className="px-3 py-2 text-neutral-800">@{row.actorUsername}</td>
                    <td className="px-3 py-2 font-medium text-neutral-900">
                      {tt(`admin.audit.action.${row.action}`)}
                    </td>
                    <td className="px-3 py-2 text-neutral-800">
                      <AuditTarget row={row} tt={tt} />
                    </td>
                    <td className="px-3 py-2">
                      {row.reason ? (
                        <span className="whitespace-pre-wrap text-neutral-800 wrap-anywhere">
                          {row.reason}
                        </span>
                      ) : (
                        <span className="text-neutral-500">{tt('admin.audit.noReason')}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTable>
          {query.isFetchNextPageError ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-700"
            >
              <p>{tt('state.error')}</p>
              <button
                type="button"
                onClick={() => void query.fetchNextPage()}
                className={`${actionClass} mt-2 text-xs font-medium text-red-700`}
              >
                {query.isFetchingNextPage ? tt('state.loading') : tt('state.retry')}
              </button>
            </div>
          ) : query.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                ref={loadMoreRef}
                type="button"
                variant="outline"
                disabled={query.isFetchingNextPage}
                aria-busy={query.isFetchingNextPage || undefined}
                onClick={() => void onLoadMore()}
              >
                {query.isFetchingNextPage ? tt('state.loading') : tt('me.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
});

function AuditTarget({
  row,
  tt,
}: {
  row: AuditRow;
  tt: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (row.targetType === 'USER') {
    return (
      <Link
        to={`/admin/users?q=${encodeURIComponent(row.targetLabel)}`}
        className="text-brand-600 hover:underline"
      >
        @{row.targetLabel}
      </Link>
    );
  }
  if (row.targetType === 'REPORT') {
    const reported = isTargetType(row.targetLabel)
      ? tt(`admin.audit.target.${row.targetLabel}`)
      : row.targetLabel;
    return (
      <Link to="/reports" className="text-brand-600 hover:underline">
        {tt('admin.audit.target.REPORT')} · {reported}
      </Link>
    );
  }
  const typeLabel = isTargetType(row.targetType)
    ? tt(`admin.audit.target.${row.targetType}`)
    : row.targetType;
  return (
    <div>
      <p className="wrap-anywhere">
        {typeLabel} · {snapshotText(row.targetLabel)}
      </p>
      {row.targetUsername ? (
        <p className="text-xs text-neutral-600">
          {tt('admin.audit.owner', { user: row.targetUsername })}
        </p>
      ) : null}
    </div>
  );
}
