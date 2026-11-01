import { t, type Locale } from '@repo/shared';

export const NOTIFICATION_PAGE_SIZE = 20;
export const UNREAD_POLL_INTERVAL_MS = 60_000;

export function unreadBadgeText(count: number): string | null {
  if (count <= 0) return null;
  if (count >= 100) return '99+';
  return String(count);
}

/** Flat dictionary: one string per key, so the three bell names are separate keys. */
export function notificationBellLabel(locale: Locale, count: number | null): string {
  if (count == null || count <= 0) return t(locale, 'notifications.bellAria');
  if (count >= 100) return t(locale, 'notifications.bellAriaOverflow');
  return t(locale, 'notifications.bellAriaCount', { n: count });
}

export function unreadSummary(locale: Locale, count: number): string {
  if (count <= 0) return t(locale, 'notifications.noneUnread');
  return t(locale, 'notifications.unreadSummary', { n: count, count });
}

export function newNotificationsLabel(locale: Locale, count: number): string {
  return t(locale, 'notifications.newAvailable', { n: count, count });
}

export function notificationActionText(
  locale: Locale,
  type: string,
  action: string | null,
): string {
  if (type === 'CONTENT_RESOLVED' && action === 'REMOVE_TARGET') {
    return t(locale, 'notifications.type.RESOLVED_REMOVE');
  }
  if (type === 'CONTENT_RESOLVED' && action === 'MARK_RESOLVED') {
    return t(locale, 'notifications.type.RESOLVED_MARK');
  }
  if (type === 'TOPIC_REPLY') return t(locale, 'notifications.type.TOPIC_REPLY');
  if (type === 'COMMENT_REPLY') return t(locale, 'notifications.type.COMMENT_REPLY');
  if (type === 'MENTION') return t(locale, 'notifications.type.MENTION');
  return '';
}

export function notificationActorLabel(
  locale: Locale,
  type: string,
  username: string | null,
): string | null {
  if (type === 'CONTENT_RESOLVED') return null;
  if (!username) return t(locale, 'notifications.actorDeleted');
  return `@${username}`;
}
