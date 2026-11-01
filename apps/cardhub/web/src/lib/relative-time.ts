const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Relative time until the instant is more than 7 days away, then a medium date.
 * Spec §9. `numeric: 'auto'` supplies “3 分钟前” / “3 minutes ago”.
 */
export function formatNotificationTime(iso: string, locale: string, now = Date.now()): string {
  const date = new Date(iso);
  const target = date.getTime();
  if (Number.isNaN(target)) return '';
  const delta = target - now;
  const abs = Math.abs(delta);
  if (abs > WEEK) return date.toLocaleDateString(locale, { dateStyle: 'medium' });
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs >= DAY) return format.format(Math.trunc(delta / DAY), 'day');
  if (abs >= HOUR) return format.format(Math.trunc(delta / HOUR), 'hour');
  if (abs >= MINUTE) return format.format(Math.trunc(delta / MINUTE), 'minute');
  return format.format(Math.trunc(delta / 1000), 'second');
}

export function formatNotificationTitle(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}
