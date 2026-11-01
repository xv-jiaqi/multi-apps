import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Bell } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { appErrorMessage, t, type Locale } from '@repo/shared';
import { Button } from '@repo/ui-web';
import { ErrorBox, dataErrorRetryClassName } from '../components/error-box';
import { PageMeta } from '../components/page-meta';
import { PageShell } from '../components/page-shell';
import { queryFallback, RetryButton, useFocusOnRecovery } from '../components/retry-button';
import {
  NOTIFICATION_PAGE_SIZE,
  UNREAD_POLL_INTERVAL_MS,
  newNotificationsLabel,
  notificationActionText,
  notificationActorLabel,
  unreadSummary,
} from '../lib/notification-copy';
import { formatNotificationTime, formatNotificationTitle } from '../lib/relative-time';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

const FOCUS_KEY = 'cardhub:notifications:focus';
const LIST_INPUT = { limit: NOTIFICATION_PAGE_SIZE };

interface NotificationRow {
  id: string;
  type: string;
  actor: { username: string } | null;
  excerpt: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
  action?: string;
}

interface RepeatNotice {
  id: number;
  text: string;
  itemId: string | null;
}

function readAppCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined;
  const data = error.data;
  if (typeof data !== 'object' || data === null || !('appCode' in data)) return undefined;
  return data.appCode;
}

function readAction(item: NotificationRow): string | null {
  if (item.action === 'MARK_RESOLVED' || item.action === 'REMOVE_TARGET') return item.action;
  return null;
}

function safeHref(href: string | null): string | null {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null;
  return href;
}

function rememberFocus(id: string): void {
  try {
    sessionStorage.setItem(FOCUS_KEY, id);
  } catch {
    // Storage can be unavailable. Back navigation then lands on the heading.
  }
}

function consumeFocus(): string | null {
  try {
    const id = sessionStorage.getItem(FOCUS_KEY);
    if (id) sessionStorage.removeItem(FOCUS_KEY);
    return id;
  } catch {
    return null;
  }
}

function NotificationSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true">
      <p className="sr-only">{label}</p>
      <ul className="space-y-2" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <li key={index} className="space-y-2 rounded-xl p-3">
            <div className="h-4 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function rowText(
  locale: Locale,
  item: NotificationRow,
): { actor: string | null; action: string; body: string } {
  const href = safeHref(item.href);
  return {
    actor: notificationActorLabel(locale, item.type, item.actor?.username ?? null),
    action: notificationActionText(locale, item.type, readAction(item)),
    body: href ? item.excerpt : t(locale, 'notifications.targetDeleted'),
  };
}

export const NotificationsPage = observer(function NotificationsPage() {
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const location = useLocation();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const arrivedSignedIn = useRef(session.isAuthenticated);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const markAllRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const syncedCount = useRef<number | null>(null);
  const noticeSeq = useRef(0);
  const loadMoreLocked = useRef(false);
  const readEpoch = useRef(0);
  const didInitialFocus = useRef(false);
  const [restoreId] = useState(consumeFocus);
  const [announced, setAnnounced] = useState<number | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [notice, setNotice] = useState<RepeatNotice | null>(null);

  useEffect(() => {
    if (session.isAuthenticated) {
      arrivedSignedIn.current = true;
      return;
    }
    if (arrivedSignedIn.current) return;
    navigate('/login', {
      replace: true,
      state: { from: `/notifications${location.search}${location.hash}` },
    });
  }, [session.isAuthenticated, navigate, location.search, location.hash]);

  const list = trpc.notifications.list.useInfiniteQuery(LIST_INPUT, {
    enabled: session.isAuthenticated,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const unread = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: session.isAuthenticated,
    retry: false,
    refetchInterval: UNREAD_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const markRead = trpc.notifications.markRead.useMutation();
  const markAllRead = trpc.notifications.markAllRead.useMutation();
  const utils = trpc.useUtils();

  const items: NotificationRow[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const initialView = list.data ? 'ready' : queryFallback(list);
  useFocusOnRecovery(initialView, headingRef);

  useEffect(() => {
    if (announced !== null || typeof unread.data?.count !== 'number') return;
    setAnnounced(unread.data.count);
    if (syncedCount.current === null) syncedCount.current = unread.data.count;
  }, [announced, unread.data?.count]);

  useLayoutEffect(() => {
    if (pendingFocusId) return;
    if (didInitialFocus.current) return;
    if (restoreId) {
      const node = itemRefs.current.get(restoreId);
      if (node) {
        node.focus({ preventScroll: true });
        didInitialFocus.current = true;
        return;
      }
      if (initialView === 'loading') return;
    }
    headingRef.current?.focus({ preventScroll: true });
    didInitialFocus.current = true;
  }, [initialView, items, pendingFocusId, restoreId]);

  useLayoutEffect(() => {
    if (!pendingFocusId) return;
    const node = itemRefs.current.get(pendingFocusId);
    if (!node) return;
    node.focus({ focusVisible: true });
    setPendingFocusId(null);
  }, [items, pendingFocusId]);

  if (!session.isAuthenticated) return null;

  const freshCount =
    syncedCount.current !== null && typeof unread.data?.count === 'number'
      ? Math.max(0, unread.data.count - syncedCount.current)
      : 0;
  const markAllLocked = announced == null || announced <= 0;
  const listError =
    initialView === 'error'
      ? { id: list.errorUpdateCount, text: appErrorMessage(locale.locale, readAppCode(list.error)) }
      : null;
  const moreError =
    list.data && list.isFetchNextPageError
      ? {
          id: list.errorUpdateCount,
          text: appErrorMessage(locale.locale, readAppCode(list.error)),
        }
      : null;

  const showNotice = (itemId: string | null, text: string) => {
    noticeSeq.current += 1;
    setNotice({ id: noticeSeq.current, text, itemId });
  };

  const reloadReadState = () =>
    Promise.all([
      utils.notifications.list.invalidate(LIST_INPUT),
      utils.notifications.unreadCount.invalidate(),
    ]).then(() => {
      const next = utils.notifications.unreadCount.getData();
      if (!next) return;
      syncedCount.current = next.count;
      setAnnounced(next.count);
    });

  const markOne = (id: string) => {
    const current = items.find((item) => item.id === id);
    if (!current || current.readAt) return;
    const epoch = readEpoch.current;
    const readAt = new Date().toISOString();
    utils.notifications.list.setInfiniteData(LIST_INPUT, (pageSet) => {
      if (!pageSet) return pageSet;
      return {
        ...pageSet,
        pages: pageSet.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => (item.id === id ? { ...item, readAt } : item)),
        })),
      };
    });
    utils.notifications.unreadCount.setData(undefined, (count) =>
      count ? { count: Math.max(0, count.count - 1) } : count,
    );
    if (syncedCount.current !== null) syncedCount.current = Math.max(0, syncedCount.current - 1);
    setAnnounced((value) => (value == null ? value : Math.max(0, value - 1)));
    setNotice((value) => (value?.itemId === id ? null : value));
    markRead.mutate(
      { id },
      {
        onError: () => {
          // A later mark-all owns the cache. This failure must not rewrite it.
          if (readEpoch.current !== epoch) return;
          void reloadReadState().then(() => {
            if (readEpoch.current !== epoch) return;
            showNotice(id, tt('notifications.actionFailed'));
          });
        },
      },
    );
  };

  const markAll = () => {
    if (markAllLocked || markAllRead.isPending) return;
    readEpoch.current += 1;
    void utils.notifications.list.cancel();
    void utils.notifications.unreadCount.cancel();
    const readAt = new Date().toISOString();
    utils.notifications.list.setInfiniteData(LIST_INPUT, (pageSet) => {
      if (!pageSet) return pageSet;
      return {
        ...pageSet,
        pages: pageSet.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => (item.readAt ? item : { ...item, readAt })),
        })),
      };
    });
    utils.notifications.unreadCount.setData(undefined, { count: 0 });
    syncedCount.current = 0;
    setAnnounced(0);
    setNotice(null);
    markAllRef.current?.focus({ preventScroll: true });
    markAllRead.mutate(undefined, {
      onError: () => {
        void reloadReadState().then(() => {
          showNotice(null, tt('notifications.actionFailed'));
          markAllRef.current?.focus({ preventScroll: true });
        });
      },
    });
  };

  const refreshNew = () => {
    const known = unread.data?.count;
    void list.refetch().then((result) => {
      if (result.isError) {
        showNotice(null, appErrorMessage(locale.locale, readAppCode(result.error)));
        return;
      }
      if (typeof known === 'number') {
        syncedCount.current = known;
        setAnnounced(known);
      }
      const first = result.data?.pages[0]?.items[0];
      if (first) setPendingFocusId(first.id);
    });
  };

  const requestNextPage = () => {
    if (loadMoreLocked.current || list.isFetchingNextPage) return;
    loadMoreLocked.current = true;
    const known = new Set(items.map((item) => item.id));
    void list
      .fetchNextPage()
      .then((result) => {
        if (result.isError) return;
        const firstNew = result.data?.pages
          .flatMap((page) => page.items)
          .find((item) => !known.has(item.id));
        if (firstNew) setPendingFocusId(firstNew.id);
      })
      .finally(() => {
        loadMoreLocked.current = false;
      });
  };

  const pageNotice = notice && notice.itemId === null ? notice : null;

  return (
    <PageShell>
      <PageMeta title={tt('nav.notifications')} noindex />
      <div className="mx-auto w-full max-w-2xl min-w-0">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {tt('nav.notifications')}
        </h1>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {announced == null ? (
            <p className="text-sm text-neutral-600">{tt('state.loading')}</p>
          ) : (
            <p role="status" className="text-sm text-neutral-900">
              {unreadSummary(locale.locale, announced)}
            </p>
          )}
          <Button
            ref={markAllRef}
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={markAllLocked || undefined}
            className={markAllLocked ? 'cursor-not-allowed opacity-50' : undefined}
            onClick={markAll}
          >
            {tt('notifications.markAll')}
          </Button>
        </div>
        {freshCount > 0 ? (
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={refreshNew}>
            {newNotificationsLabel(locale.locale, freshCount)}
          </Button>
        ) : null}
        {pageNotice ? (
          <p key={pageNotice.id} role="alert" className="mt-3 text-sm text-red-700">
            {pageNotice.text}
          </p>
        ) : null}
        <div className="mt-4">
          {listError ? (
            <ErrorBox
              key={listError.id}
              title={listError.text}
              retryLabel={tt('state.retry')}
              retryingLabel={tt('state.retrying')}
              retrying={list.isFetching}
              retry={() => {
                void list.refetch();
              }}
              retryClassName={dataErrorRetryClassName}
            />
          ) : null}
          {initialView === 'loading' ? <NotificationSkeleton label={tt('state.loading')} /> : null}
          {initialView === 'ready' && items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 px-4 py-10 text-center">
              <Bell className="mx-auto size-8 text-neutral-600" aria-hidden />
              <p className="mt-3 font-medium text-neutral-900">{tt('notifications.empty')}</p>
              <p className="mt-1 text-sm text-neutral-600">{tt('notifications.emptyHint')}</p>
            </div>
          ) : null}
          {initialView === 'ready' && items.length > 0 ? (
            <ul className="space-y-1">
              {items.map((item) => (
                <NotificationItem
                  key={item.id}
                  item={item}
                  locale={locale.locale}
                  notice={notice?.itemId === item.id ? notice : null}
                  itemRef={(node) => {
                    if (node) itemRefs.current.set(item.id, node);
                    else itemRefs.current.delete(item.id);
                  }}
                  onOpen={() => {
                    rememberFocus(item.id);
                    markOne(item.id);
                  }}
                  onMark={() => markOne(item.id)}
                  markLabel={tt('notifications.markOne')}
                  unreadPrefix={tt('notifications.unreadPrefix')}
                />
              ))}
            </ul>
          ) : null}
          {initialView === 'ready' && list.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="outline"
                aria-disabled={list.isFetchingNextPage || undefined}
                aria-busy={list.isFetchingNextPage || undefined}
                className={list.isFetchingNextPage ? 'cursor-not-allowed opacity-50' : undefined}
                onClick={requestNextPage}
              >
                {list.isFetchingNextPage ? tt('state.loading') : tt('me.loadMore')}
              </Button>
            </div>
          ) : null}
          {moreError ? (
            <p key={moreError.id} role="alert" className="mt-2 text-center text-sm text-red-700">
              {moreError.text}{' '}
              <RetryButton
                variant="inline"
                retrying={list.isFetchingNextPage}
                label={tt('state.retry')}
                retryingLabel={tt('state.retrying')}
                onRetry={requestNextPage}
              />
            </p>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
});

function NotificationItem({
  item,
  locale,
  notice,
  itemRef,
  onOpen,
  onMark,
  markLabel,
  unreadPrefix,
}: {
  item: NotificationRow;
  locale: Locale;
  notice: RepeatNotice | null;
  itemRef: (node: HTMLElement | null) => void;
  onOpen: () => void;
  onMark: () => void;
  markLabel: string;
  unreadPrefix: string;
}) {
  const unread = item.readAt == null;
  const href = safeHref(item.href);
  const copy = rowText(locale, item);
  const when = formatNotificationTime(item.createdAt, locale);
  const title = formatNotificationTitle(item.createdAt, locale);
  const body = (
    <>
      <span
        aria-hidden
        className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? 'bg-brand-600' : 'bg-transparent'}`}
      />
      <span className="min-w-0 flex-1">
        {unread ? <span className="sr-only">{unreadPrefix} </span> : null}
        <span
          className={`block text-sm text-neutral-900 ${unread ? 'font-semibold' : 'font-normal'}`}
        >
          {copy.actor ? (
            <span className={unread ? 'font-semibold' : 'font-medium'}>{copy.actor} </span>
          ) : null}
          {copy.action}
        </span>
        <span className="mt-1 min-w-0 text-sm text-neutral-600 line-clamp-2 wrap-anywhere">
          {copy.body}
        </span>
        <time
          dateTime={item.createdAt}
          title={title}
          className="mt-1 block text-xs text-neutral-600"
        >
          {when}
        </time>
      </span>
    </>
  );
  const className =
    'flex min-h-12 min-w-0 items-start gap-3 rounded-xl p-3 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

  return (
    <li className="min-w-0">
      {href ? (
        <Link ref={itemRef} to={href} className={className} onClick={onOpen}>
          {body}
        </Link>
      ) : (
        <div ref={itemRef} tabIndex={-1} className={`${className} focus:outline-none`}>
          {body}
          {unread ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-6 shrink-0"
              onClick={onMark}
            >
              {markLabel}
            </Button>
          ) : null}
        </div>
      )}
      {notice ? (
        <p key={notice.id} role="alert" className="px-3 text-sm text-red-700">
          {notice.text}
        </p>
      ) : null}
    </li>
  );
}
