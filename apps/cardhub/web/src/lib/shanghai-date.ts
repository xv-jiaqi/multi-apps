const SHANGHAI_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar day in Asia/Shanghai as `YYYY-MM-DD`. */
export function shanghaiToday(now: Date = new Date()): string {
  const parts = SHANGHAI_DAY.formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

/**
 * Add calendar days to a `YYYY-MM-DD` string. The input is a civil date, not
 * an instant, so the arithmetic uses UTC midnight only as a day counter.
 */
export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  const nextYear = String(utc.getUTCFullYear()).padStart(4, '0');
  const nextMonth = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(utc.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}
