import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { APP_ERROR_CODES, t } from '@repo/shared';
import { Button, Input, SegmentedControl } from '@repo/ui-web';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import { BanUserDialog } from '../../components/admin/ban-user-dialog';
import {
  AdminErrorBox,
  AdminStatus,
  AdminTable,
  AdminTableHead,
  AdminTh,
  actionClass,
} from '../../components/admin/admin-table';
import { useAdminNotice } from '../../components/admin/use-admin-notice';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';

const PAGE_SIZE = 20;

/** 375 only. `sm:` puts the desktop table back to the v4 layout. */
const stickyUsernameClassName =
  'sticky left-0 z-10 max-w-32 border-r border-neutral-200 sm:static sm:max-w-none sm:border-r-0';

type UserStatus = 'all' | 'active' | 'banned';
type DialogMode = 'ban' | 'unban';

export interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  role: string;
  createdAt: string;
  bannedAt: string | null;
  bannedBy: { username: string } | null;
  counts: { topics: number; replies: number; comments: number; listings: number };
}

interface UsersPage {
  items: AdminUserRow[];
  total: number;
  nextCursor: string | null;
}

function parseStatus(value: string | null): UserStatus {
  return value === 'active' || value === 'banned' ? value : 'all';
}

function readData(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined;
  const data = error.data;
  if (typeof data !== 'object' || data === null) return undefined;
  return data as Record<string, unknown>;
}

function readAppCode(error: unknown): string | undefined {
  const appCode = readData(error)?.appCode;
  return typeof appCode === 'string' ? appCode : undefined;
}

function readTrpcCode(error: unknown): string | undefined {
  const code = readData(error)?.code;
  return typeof code === 'string' ? code : undefined;
}

function isUserRow(value: unknown): value is AdminUserRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<AdminUserRow>;
  return typeof row.id === 'string' && typeof row.username === 'string';
}

function readSubject(error: unknown): AdminUserRow | null {
  const subject = readData(error)?.subject;
  return isUserRow(subject) ? subject : null;
}

export const AdminUsersPage = observer(function AdminUsersPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  return (
    <PageShell>
      <PageMeta title={tt('admin.users.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('nav.admin') },
            { label: tt('nav.users') },
          ]}
        />
        <AdminGate>
          <UsersBody />
        </AdminGate>
      </div>
    </PageShell>
  );
});

const UsersBody = observer(function UsersBody() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const { notice, setNotice, statusRef } = useAdminNotice();
  const [searchParams, setSearchParams] = useSearchParams();
  const qParam = searchParams.get('q') ?? '';
  const status = parseStatus(searchParams.get('status'));
  const [draft, setDraft] = useState(qParam);
  const [dialog, setDialog] = useState<{ mode: DialogMode; user: AdminUserRow } | null>(null);
  const [dialogAlert, setDialogAlert] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageErrorRef = useRef<HTMLParagraphElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableCellElement>());
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreActionUserId = useRef<string | null>(null);
  const focusNoticeOnClose = useRef(false);
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;
  const utils = trpc.useUtils();

  useEffect(() => {
    setDraft(qParam);
  }, [qParam]);

  // Search text is debounced into `q` only. Status stays on the URL until
  // setStatus or clearFilters changes it. A render effect that cloned
  // searchParams raced with clearFilters: debounced `q` updated first, and
  // the effect published the previous `status=banned` back over the cleared URL.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const trimmed = draft.trim();
      const next = new URLSearchParams(paramsRef.current);
      const current = (next.get('q') ?? '').trim();
      if (trimmed === current) return;
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      setSearchParams(next, { replace: true });
      setNotice(null);
      setPageError(null);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [draft, setNotice, setPageError, setSearchParams]);

  const listInput = useMemo(
    () => ({
      limit: PAGE_SIZE,
      ...(qParam.trim() ? { q: qParam.trim() } : {}),
      ...(status === 'all' ? {} : { status }),
    }),
    [qParam, status],
  );

  const query = trpc.admin.users.list.useInfiniteQuery(listInput, {
    getNextPageParam: (last: UsersPage) => last.nextCursor ?? undefined,
  });
  const ban = trpc.admin.users.ban.useMutation();
  const unban = trpc.admin.users.unban.useMutation();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const revoked =
    query.isError && !query.isFetchingNextPage && readTrpcCode(query.error) === 'FORBIDDEN';
  const pending = ban.isPending || unban.isPending;

  useEffect(() => {
    if (revoked) reportForbidden();
  }, [reportForbidden, revoked]);

  useEffect(() => {
    if (pageError) pageErrorRef.current?.focus();
  }, [pageError]);

  useEffect(() => {
    if (dialog !== null || focusNoticeOnClose.current) return;
    const userId = restoreActionUserId.current;
    if (!userId) return;
    // After close, the row may have rendered a new button. Read the map
    // after commit instead of focusing the node that opened the dialog.
    const frame = window.requestAnimationFrame(() => {
      actionRefs.current.get(userId)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog]);

  const setStatus = (next: UserStatus) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
    setNotice(null);
    setPageError(null);
  };

  const clearFilters = () => {
    setDraft('');
    setSearchParams(new URLSearchParams(), { replace: true });
    setNotice(null);
    setPageError(null);
    searchRef.current?.focus();
  };

  const replaceRow = (next: AdminUserRow) => {
    utils.admin.users.list.setInfiniteData(listInput, (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => (item.id === next.id ? next : item)),
        })),
      };
    });
  };

  const finishSuccess = (next: AdminUserRow, message: string) => {
    replaceRow(next);
    setDialogAlert(null);
    setPageError(null);
    restoreActionUserId.current = null;
    focusNoticeOnClose.current = true;
    setNotice(message);
    setDialog(null);
  };

  const submit = async (reason: string) => {
    if (!dialog) return;
    setDialogAlert(null);
    const mutation = dialog.mode === 'ban' ? ban : unban;
    try {
      const row = await mutation.mutateAsync({ userId: dialog.user.id, reason });
      finishSuccess(
        row,
        tt(dialog.mode === 'ban' ? 'admin.ban.done' : 'admin.unban.done', {
          user: row.username,
        }),
      );
    } catch (error) {
      const appCode = readAppCode(error);
      const subject = readSubject(error);
      if (appCode === APP_ERROR_CODES.ALREADY_BANNED || appCode === APP_ERROR_CODES.NOT_BANNED) {
        if (subject)
          finishSuccess(
            subject,
            tt(dialog.mode === 'ban' ? 'admin.ban.done' : 'admin.unban.done', {
              user: subject.username,
            }),
          );
        else {
          void query.refetch();
          finishSuccess(
            dialog.user,
            tt(dialog.mode === 'ban' ? 'admin.ban.done' : 'admin.unban.done', {
              user: dialog.user.username,
            }),
          );
        }
        return;
      }
      if (appCode === APP_ERROR_CODES.NOT_FOUND || readTrpcCode(error) === 'NOT_FOUND') {
        restoreActionUserId.current = null;
        setDialog(null);
        setPageError(tt('admin.users.gone'));
        void query.refetch();
        return;
      }
      if (readTrpcCode(error) === 'FORBIDDEN' && !appCode) {
        reportForbidden();
        return;
      }
      if (appCode === APP_ERROR_CODES.CANNOT_BAN_ADMIN) {
        setDialogAlert(tt('admin.ban.cannotAdmin'));
        return;
      }
      if (appCode === APP_ERROR_CODES.CANNOT_BAN_SELF) {
        setDialogAlert(tt('admin.ban.cannotSelf'));
        return;
      }
      if (readTrpcCode(error) === 'FORBIDDEN' && appCode === APP_ERROR_CODES.FORBIDDEN) {
        reportForbidden();
        return;
      }
      setDialogAlert(tt(dialog.mode === 'ban' ? 'admin.ban.failed' : 'admin.unban.failed'));
    }
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

  const filteredEmpty = !query.isLoading && !query.isError && items.length === 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1
          tabIndex={-1}
          className="text-2xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {tt('admin.users.title')}
        </h1>
        <p className="text-sm text-neutral-600">{tt('admin.users.subtitle')}</p>
      </header>
      {pageError ? (
        <p
          ref={pageErrorRef}
          role="alert"
          tabIndex={-1}
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {pageError}
        </p>
      ) : (
        <AdminStatus message={notice} statusRef={statusRef} />
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <label htmlFor="admin-user-search" className="sr-only">
            {tt('admin.users.search')}
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-500"
          />
          <Input
            ref={searchRef}
            id="admin-user-search"
            size="sm"
            type="search"
            autoComplete="off"
            value={draft}
            placeholder={tt('admin.users.search')}
            onChange={(event) => setDraft(event.target.value)}
            className="w-full pl-8"
          />
        </div>
        <SegmentedControl
          legend={tt('admin.users.colStatus')}
          legendSrOnly
          name="admin-user-status"
          value={status}
          onValueChange={(value) => setStatus(parseStatus(value))}
          options={[
            { value: 'all', label: tt('admin.users.filterAll') },
            { value: 'active', label: tt('admin.users.filterActive') },
            { value: 'banned', label: tt('admin.users.filterBanned') },
          ]}
        />
      </div>
      {revoked ? null : query.isError && !query.data ? (
        <AdminErrorBox
          title={tt('state.error')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          retryLabel={tt('state.retry')}
          retryingLabel={tt('state.retrying')}
        />
      ) : (
        <>
          {query.isLoading ? null : (
            <p role="status" className="text-sm text-neutral-600">
              {tt('admin.users.total', { count: total })}
            </p>
          )}
          <AdminTable
            caption={tt('admin.users.caption')}
            busy={query.isLoading}
            className="scroll-pl-32 sm:scroll-pl-0"
          >
            <AdminTableHead>
              <AdminTh className={`${stickyUsernameClassName} bg-neutral-50`}>
                {tt('admin.users.colUser')}
              </AdminTh>
              <AdminTh>{tt('admin.users.colEmail')}</AdminTh>
              <AdminTh>{tt('admin.users.colStatus')}</AdminTh>
              <AdminTh>{tt('admin.users.colJoined')}</AdminTh>
              <AdminTh align="right">{tt('admin.users.colContent')}</AdminTh>
              <AdminTh align="right">{tt('admin.col.actions')}</AdminTh>
            </AdminTableHead>
            <tbody className="divide-y divide-neutral-200">
              {query.isLoading
                ? Array.from({ length: 5 }, (_, index) => (
                    <tr key={index}>
                      {Array.from({ length: 6 }, (_, cell) => (
                        <td
                          key={cell}
                          className={
                            cell === 0
                              ? `${stickyUsernameClassName} bg-white px-3 py-2`
                              : 'px-3 py-2'
                          }
                        >
                          <span className="block h-4 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none" />
                        </td>
                      ))}
                    </tr>
                  ))
                : null}
              {filteredEmpty ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-neutral-600">
                    {tt('admin.users.noMatch')}{' '}
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
              {items.map((user) => {
                const banned = user.bannedAt !== null;
                const content =
                  user.counts.topics +
                  user.counts.replies +
                  user.counts.comments +
                  user.counts.listings;
                const breakdown = tt('admin.users.contentBreakdown', user.counts);
                const showModeration = user.role !== 'admin' && user.id !== session.user?.id;
                const joined = new Date(user.createdAt).toLocaleDateString(locale.locale, {
                  dateStyle: 'medium',
                });
                const bannedTime = user.bannedAt
                  ? new Date(user.bannedAt).toLocaleString(locale.locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : '';
                return (
                  <tr key={user.id}>
                    <th
                      scope="row"
                      tabIndex={-1}
                      ref={(node) => {
                        if (node) rowRefs.current.set(user.id, node);
                        else rowRefs.current.delete(user.id);
                      }}
                      className={`${stickyUsernameClassName} bg-white px-3 py-2 text-left font-medium text-neutral-900 wrap-anywhere focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500`}
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 wrap-anywhere">@{user.username}</span>
                        {user.role === 'admin' ? (
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                            {tt('me.roleAdmin')}
                          </span>
                        ) : null}
                      </span>
                    </th>
                    <td className="px-3 py-2 text-neutral-600 wrap-anywhere">{user.email}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          banned
                            ? 'inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200'
                            : 'inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200'
                        }
                      >
                        {tt(banned ? 'admin.users.statusBanned' : 'admin.users.statusActive')}
                      </span>
                      {banned ? (
                        <p className="mt-1 text-xs text-neutral-600">
                          {tt('admin.users.bannedMeta', {
                            time: bannedTime,
                            admin: user.bannedBy?.username ?? '',
                          })}
                        </p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-700">{joined}</td>
                    <td
                      className="px-3 py-2 text-right tabular-nums text-neutral-800"
                      title={breakdown}
                      aria-label={breakdown}
                    >
                      {content}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <div className="flex justify-end gap-3">
                        {showModeration ? (
                          <button
                            type="button"
                            ref={(node) => {
                              if (node) actionRefs.current.set(user.id, node);
                              else actionRefs.current.delete(user.id);
                            }}
                            className={
                              banned
                                ? `${actionClass} text-xs font-medium text-brand-600 hover:underline`
                                : `${actionClass} text-xs text-red-600 hover:underline`
                            }
                            aria-label={tt(
                              banned ? 'admin.users.unbanAria' : 'admin.users.banAria',
                              {
                                user: user.username,
                              },
                            )}
                            onClick={() => {
                              restoreActionUserId.current = user.id;
                              setDialogAlert(null);
                              setDialog({ mode: banned ? 'unban' : 'ban', user });
                            }}
                          >
                            {tt(banned ? 'admin.users.unban' : 'admin.users.ban')}
                          </button>
                        ) : null}
                        <Link
                          to={`/admin/audit?user=${encodeURIComponent(user.username)}`}
                          className={`${actionClass} text-xs text-neutral-600 hover:underline`}
                          aria-label={tt('admin.users.historyAria', { user: user.username })}
                        >
                          {tt('admin.users.history')}
                        </Link>
                      </div>
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
      <BanUserDialog
        mode={dialog?.mode ?? 'ban'}
        username={dialog?.user.username ?? ''}
        open={dialog !== null}
        pending={pending}
        alertMessage={dialogAlert}
        onOpenChange={(next) => {
          if (!next) {
            setDialog(null);
            setDialogAlert(null);
          }
        }}
        onConfirm={(reason) => void submit(reason)}
        onCloseAutoFocus={(event) => {
          // Radix would focus the element that opened the dialog. That node
          // can already be gone: the row re-renders during close, and a
          // successful ban replaces 封禁 with 解封. Look the button up by
          // userId after the next frame. Success still moves focus to the notice.
          event.preventDefault();
          const userId = restoreActionUserId.current;
          if (focusNoticeOnClose.current) {
            focusNoticeOnClose.current = false;
            window.requestAnimationFrame(() => statusRef.current?.focus());
            return;
          }
          window.requestAnimationFrame(() => {
            if (!userId) return;
            actionRefs.current.get(userId)?.focus();
          });
        }}
      />
    </div>
  );
});
