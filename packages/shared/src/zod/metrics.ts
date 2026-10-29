import { z } from 'zod';

/** Inclusive UTC day span accepted by `admin.metrics`. A leap year fits; one day more does not. */
export const METRICS_RANGE_MAX_DAYS = 366;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` as UTC midnight, or null when the calendar day does not exist. */
export function utcCalendarDate(value: string): Date | null {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** UTC calendar day of an instant. The time of day is discarded. */
export function utcCalendarDateFromInstant(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

export function formatUtcCalendarDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Inclusive day count. `from` and `to` must be UTC midnights. */
export function inclusiveUtcDayCount(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/**
 * Date window for `admin.metrics`. Both ends are inclusive UTC calendar dates.
 * The span is capped so a query cannot scan an unbounded history.
 */
export const adminMetricsInput = z
  .object({
    from: z.string().trim(),
    to: z.string().trim(),
  })
  .superRefine((value, ctx) => {
    const from = utcCalendarDate(value.from);
    const to = utcCalendarDate(value.to);
    if (!from) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'invalid_date' });
    }
    if (!to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'invalid_date' });
    }
    if (!from || !to) return;
    if (to.getTime() < from.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'metrics_range_order' });
      return;
    }
    if (inclusiveUtcDayCount(from, to) > METRICS_RANGE_MAX_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'metrics_range_too_long' });
    }
  });

export type AdminMetricsInput = z.infer<typeof adminMetricsInput>;
