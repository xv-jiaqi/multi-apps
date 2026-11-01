import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { Bell } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import {
  notificationBellLabel,
  unreadBadgeText,
  UNREAD_POLL_INTERVAL_MS,
} from '../lib/notification-copy';
import { clearNotificationCache } from '../lib/notification-cache';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

const UnreadContext = createContext<number | null>(null);

function useUnreadQuery(useUnread: typeof trpc.notifications.unreadCount.useQuery): number | null {
  const query = useUnread(undefined, {
    retry: false,
    refetchInterval: UNREAD_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  return query.data ? query.data.count : null;
}

function ConnectedUnread({
  useUnread,
  children,
}: {
  useUnread: typeof trpc.notifications.unreadCount.useQuery;
  children: ReactNode;
}) {
  const count = useUnreadQuery(useUnread);
  return <UnreadContext.Provider value={count}>{children}</UnreadContext.Provider>;
}

export function NotificationUnreadProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const useUnread = trpc.notifications?.unreadCount?.useQuery;
  if (!enabled || !useUnread) {
    return <UnreadContext.Provider value={null}>{children}</UnreadContext.Provider>;
  }
  return <ConnectedUnread useUnread={useUnread}>{children}</ConnectedUnread>;
}

export function useNotificationUnread(): number | null {
  return useContext(UnreadContext);
}

/** Stops the poll and drops cached rows when the signed-in header signs out. */
export const NotificationCacheReset = observer(function NotificationCacheReset() {
  const { session } = useStores();
  const wasAuthenticated = useRef(session.isAuthenticated);

  useEffect(() => {
    if (wasAuthenticated.current && !session.isAuthenticated) clearNotificationCache();
    wasAuthenticated.current = session.isAuthenticated;
  }, [session.isAuthenticated]);

  return null;
});

const bellClassName =
  'relative inline-flex items-center justify-center rounded-md p-2 text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

export function NotificationBell({ className }: { className?: string }) {
  const { locale } = useStores();
  const { pathname } = useLocation();
  const count = useNotificationUnread();
  const label = notificationBellLabel(locale.locale, count);
  const badge = count == null ? null : unreadBadgeText(count);

  return (
    <Link
      to="/notifications"
      aria-label={label}
      aria-current={pathname === '/notifications' ? 'page' : undefined}
      className={`${bellClassName} ${className ?? ''}`}
    >
      <Bell className="size-5" aria-hidden />
      {badge ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 min-w-5 h-5 rounded-full bg-brand-600 px-1 text-center text-xs font-semibold leading-5 text-white tabular-nums ring-2 ring-white"
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
