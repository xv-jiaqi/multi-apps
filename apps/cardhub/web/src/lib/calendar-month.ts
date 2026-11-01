import { shanghaiMonthBounds } from '@repo/shared';

/**
 * Local noon of a civil date. `setFullYear` keeps years 1–99 from sliding
 * into the 1900s, which `new Date(year, …)` does for two-digit years.
 */
function civilDate(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setFullYear(year, monthIndex, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

function utcStamp(year: number, monthIndex: number, day: number): string {
  const date = new Date(Date.UTC(2000, monthIndex, day));
  date.setUTCFullYear(year, monthIndex, day);
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Closed `YYYY-MM-DD` bounds. Years 1–99 stay in that century. */
export function calendarMonthRange(month: string): { from: string; to: string } | null {
  if (!shanghaiMonthBounds(month)) return null;
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  return {
    from: utcStamp(year, mon - 1, 1),
    to: utcStamp(year, mon, 0),
  };
}

/** `YYYY-MM` when it is a real civil month, otherwise the month of `today`. */
export function parseCalendarMonth(value: string | null, today: string): string {
  if (value && shanghaiMonthBounds(value)) return value;
  return today.slice(0, 7);
}

/** Move a `YYYY-MM` by whole months. Stops at year 0001 and 9999. */
export function shiftCalendarMonth(month: string, delta: number): string | null {
  if (!shanghaiMonthBounds(month)) return null;
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const index = year * 12 + (mon - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  if (nextYear < 1 || nextYear > 9999 || nextMonth < 1) return null;
  const label = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
  return shanghaiMonthBounds(label) ? label : null;
}

/** `2026年11月` or `November 2026`. Built from the civil month, not an instant. */
export function monthHeading(locale: string, month: string): string {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  if (locale.startsWith('zh')) return `${year}年${mon}月`;
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    civilDate(year, mon - 1, 1),
  );
}

/** `11月内` or `In November`. */
export function withinMonthLabel(locale: string, month: string): string {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  if (locale.startsWith('zh')) return `${mon}月内`;
  const name = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(
    civilDate(year, mon - 1, 1),
  );
  return `In ${name}`;
}

/**
 * `11月6日 周五` or `Fri, Nov 6`. `todaySuffix` is appended only for the
 * Shanghai civil today, and the date parts come from the `YYYY-MM-DD` text.
 */
export function dayHeading(
  locale: string,
  isoDate: string,
  today: boolean,
  todaySuffix: string,
): string {
  const [yearText, monthText, dayText] = isoDate.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = civilDate(year, month - 1, day);
  const suffix = today ? ` · ${todaySuffix}` : '';
  if (locale.startsWith('zh')) {
    const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date);
    return `${month}月${day}日 ${weekday}${suffix}`;
  }
  const formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
  return `${formatted}${suffix}`;
}

export interface CalendarRelease {
  id: string;
  title: string;
  releaseDate: string;
  datePrecision: 'DAY' | 'MONTH';
}

/** Day groups stay in date order. Titles inside a day follow the UI locale. */
export function groupCalendarReleases<T extends CalendarRelease>(
  items: T[],
  locale: string,
): { days: Array<{ date: string; items: T[] }>; monthOnly: T[] } {
  const byTitle = (left: T, right: T) => left.title.localeCompare(right.title, locale);
  const monthOnly = items
    .filter((item) => item.datePrecision === 'MONTH')
    .slice()
    .sort(byTitle);
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    if (item.datePrecision === 'MONTH') continue;
    const group = byDay.get(item.releaseDate);
    if (group) group.push(item);
    else byDay.set(item.releaseDate, [item]);
  }
  const days = [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, group]) => ({ date, items: group.slice().sort(byTitle) }));
  return { days, monthOnly };
}
