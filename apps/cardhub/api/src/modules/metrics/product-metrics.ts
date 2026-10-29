import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import {
  APP_ERROR_CODES,
  formatUtcCalendarDate,
  inclusiveUtcDayCount,
  utcCalendarDate,
  type AdminMetricsInput,
} from '@repo/shared';
import type { PrismaService } from '../prisma/prisma.service';

export interface RetentionSlice {
  cohortUsers: number;
  retainedUsers: number;
  rate: number | null;
}

export interface ProductMetrics {
  from: string;
  to: string;
  dayCount: number;
  mau: {
    activeUsers: number;
    byMonth: Array<{ month: string; activeUsers: number }>;
  };
  registrations: {
    total: number;
    byDay: Array<{ date: string; count: number }>;
  };
  retention: {
    nextDay: RetentionSlice;
    day7: RetentionSlice;
  };
  comments: {
    total: number;
    perDay: number;
  };
}

/**
 * Non-negative ratio rounded half away from zero to 4 decimal places.
 * Null when the denominator is 0.
 */
export function ratioTo4(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator * 10_000) / denominator) / 10_000;
}

/** Stored timestamps are UTC wall time. Read them back as a UTC calendar date. */
const utcDay = Prisma.raw(`(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::date`);

function requireCalendarDate(value: string): Date {
  const date = utcCalendarDate(value);
  if (!date) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'invalid_date',
      cause: { appCode: APP_ERROR_CODES.VALIDATION },
    });
  }
  return date;
}

function readCount(value: unknown): number {
  const count = typeof value === 'bigint' ? Number(value) : value;
  if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) return count;
  throw new Error('metrics count was not an integer');
}

function eachUtcDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(from.getTime());
  while (cursor.getTime() <= to.getTime()) {
    days.push(formatUtcCalendarDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function eachUtcMonth(from: Date, to: Date): string[] {
  const months: string[] = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  const end = to.getUTCFullYear() * 12 + to.getUTCMonth();
  while (year * 12 + month <= end) {
    months.push(`${year}-${String(month + 1).padStart(2, '0')}`);
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

type CountRow = { count: number | bigint };
type ActiveRow = { activeUsers: number | bigint };
type DayRow = { day: string; count: number | bigint };
type MonthRow = { month: string; activeUsers: number | bigint };
type RetentionRow = {
  cohortUsers: number | bigint;
  nextDay: number | bigint;
  day7: number | bigint;
};

function retentionSlice(retainedUsers: number, cohortUsers: number): RetentionSlice {
  return {
    cohortUsers,
    retainedUsers,
    rate: ratioTo4(retainedUsers, cohortUsers),
  };
}

export async function loadProductMetrics(
  prisma: PrismaService,
  input: AdminMetricsInput,
): Promise<ProductMetrics> {
  const from = requireCalendarDate(input.from);
  const to = requireCalendarDate(input.to);
  const fromIso = formatUtcCalendarDate(from);
  const toIso = formatUtcCalendarDate(to);
  const dayCount = inclusiveUtcDayCount(from, to);

  const [activeRows, monthRows, registrationRows, retentionRows, commentRows] = await Promise.all([
    prisma.$queryRaw<ActiveRow[]>`
      SELECT COUNT(DISTINCT "userId")::int AS "activeUsers"
      FROM user_daily_activities
      WHERE day >= CAST(${fromIso} AS date) AND day <= CAST(${toIso} AS date)
    `,
    prisma.$queryRaw<MonthRow[]>`
      SELECT to_char(day, 'YYYY-MM') AS month,
             COUNT(DISTINCT "userId")::int AS "activeUsers"
      FROM user_daily_activities
      WHERE day >= CAST(${fromIso} AS date) AND day <= CAST(${toIso} AS date)
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<DayRow[]>`
      SELECT to_char(${utcDay}, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM users
      WHERE ${utcDay} BETWEEN CAST(${fromIso} AS date) AND CAST(${toIso} AS date)
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<RetentionRow[]>`
      WITH cohort AS (
        SELECT id, ${utcDay} AS registered_on
        FROM users
        WHERE ${utcDay} BETWEEN CAST(${fromIso} AS date) AND CAST(${toIso} AS date)
      )
      SELECT
        COUNT(*)::int AS "cohortUsers",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM user_daily_activities AS activity
            WHERE activity."userId" = cohort.id
              AND activity.day = cohort.registered_on + 1
          )
        )::int AS "nextDay",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM user_daily_activities AS activity
            WHERE activity."userId" = cohort.id
              AND activity.day = cohort.registered_on + 7
          )
        )::int AS "day7"
      FROM cohort
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM comments
      WHERE ${utcDay} BETWEEN CAST(${fromIso} AS date) AND CAST(${toIso} AS date)
    `,
  ]);

  const registrationsByDay = new Map(
    registrationRows.map((row) => [row.day, readCount(row.count)]),
  );
  const byDay = eachUtcDay(from, to).map((date) => ({
    date,
    count: registrationsByDay.get(date) ?? 0,
  }));

  const activeByMonth = new Map(monthRows.map((row) => [row.month, readCount(row.activeUsers)]));
  const byMonth = eachUtcMonth(from, to).map((month) => ({
    month,
    activeUsers: activeByMonth.get(month) ?? 0,
  }));

  const retention = retentionRows[0];
  const cohortUsers = readCount(retention?.cohortUsers ?? 0);
  const commentTotal = readCount(commentRows[0]?.count ?? 0);

  return {
    from: fromIso,
    to: toIso,
    dayCount,
    mau: {
      activeUsers: readCount(activeRows[0]?.activeUsers ?? 0),
      byMonth,
    },
    registrations: {
      total: byDay.reduce((sum, day) => sum + day.count, 0),
      byDay,
    },
    retention: {
      nextDay: retentionSlice(readCount(retention?.nextDay ?? 0), cohortUsers),
      day7: retentionSlice(readCount(retention?.day7 ?? 0), cohortUsers),
    },
    comments: {
      total: commentTotal,
      perDay: ratioTo4(commentTotal, dayCount) ?? 0,
    },
  };
}
