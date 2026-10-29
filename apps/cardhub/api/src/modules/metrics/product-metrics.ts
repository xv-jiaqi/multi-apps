import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import {
  APP_ERROR_CODES,
  formatUtcCalendarDate,
  inclusiveUtcDayCount,
  utcCalendarDate,
  utcCalendarDateFromInstant,
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

/** UTC clock time stored in `timestamp without time zone`, with no function on the column. */
function utcTimestampLiteral(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`;
}

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
  nextDayCohort: number | bigint;
  nextDayRetained: number | bigint;
  day7Cohort: number | bigint;
  day7Retained: number | bigint;
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
  const todayIso = formatUtcCalendarDate(utcCalendarDateFromInstant(new Date()));
  const rangeStart = utcTimestampLiteral(from);
  const rangeEnd = utcTimestampLiteral(new Date(to.getTime() + 86_400_000));
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
      SELECT to_char(days.day_start, 'YYYY-MM-DD') AS day,
             COUNT(users.id)::int AS count
      FROM generate_series(
        CAST(${rangeStart} AS timestamp),
        CAST(${utcTimestampLiteral(to)} AS timestamp),
        interval '1 day'
      ) AS days(day_start)
      LEFT JOIN users
        ON users."createdAt" >= days.day_start
       AND users."createdAt" < days.day_start + interval '1 day'
      GROUP BY days.day_start
      ORDER BY days.day_start
    `,
    prisma.$queryRaw<RetentionRow[]>`
      WITH activity_start AS (
        SELECT MIN(day) AS started_on FROM user_daily_activities
      ),
      cohort AS (
        SELECT users.id, days.day_start::date AS registered_on
        FROM generate_series(
          CAST(${rangeStart} AS timestamp),
          CAST(${utcTimestampLiteral(to)} AS timestamp),
          interval '1 day'
        ) AS days(day_start)
        JOIN users
          ON users."createdAt" >= days.day_start
         AND users."createdAt" < days.day_start + interval '1 day'
      )
      SELECT
        COUNT(*) FILTER (
          WHERE registered_on + 1 >= (SELECT started_on FROM activity_start)
            AND registered_on + 1 < CAST(${todayIso} AS date)
        )::int AS "nextDayCohort",
        COUNT(*) FILTER (
          WHERE registered_on + 1 >= (SELECT started_on FROM activity_start)
            AND registered_on + 1 < CAST(${todayIso} AS date)
            AND EXISTS (
              SELECT 1
              FROM user_daily_activities AS activity
              WHERE activity."userId" = cohort.id
                AND activity.day = cohort.registered_on + 1
            )
        )::int AS "nextDayRetained",
        COUNT(*) FILTER (
          WHERE registered_on + 7 >= (SELECT started_on FROM activity_start)
            AND registered_on + 7 < CAST(${todayIso} AS date)
        )::int AS "day7Cohort",
        COUNT(*) FILTER (
          WHERE registered_on + 7 >= (SELECT started_on FROM activity_start)
            AND registered_on + 7 < CAST(${todayIso} AS date)
            AND EXISTS (
              SELECT 1
              FROM user_daily_activities AS activity
              WHERE activity."userId" = cohort.id
                AND activity.day = cohort.registered_on + 7
            )
        )::int AS "day7Retained"
      FROM cohort
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM comments
      WHERE "createdAt" >= CAST(${rangeStart} AS timestamp)
        AND "createdAt" < CAST(${rangeEnd} AS timestamp)
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
      nextDay: retentionSlice(
        readCount(retention?.nextDayRetained ?? 0),
        readCount(retention?.nextDayCohort ?? 0),
      ),
      day7: retentionSlice(
        readCount(retention?.day7Retained ?? 0),
        readCount(retention?.day7Cohort ?? 0),
      ),
    },
    comments: {
      total: commentTotal,
      perDay: ratioTo4(commentTotal, dayCount) ?? 0,
    },
  };
}
