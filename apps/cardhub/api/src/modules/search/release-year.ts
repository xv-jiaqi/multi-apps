import type { Prisma } from '@prisma/client';

function utcCivilDate(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Asia/Shanghai release year on `series.releaseDate`.
 *
 * The column is a civil `@db.Date` (no time of day). Its year is already the
 * Shanghai calendar year the catalog stores. Bounds are UTC midnights of
 * 1 January so Postgres date/timestamp casts keep 31 December of the previous
 * year out and 1 January of the next year out. Year 0 is a valid `y:` format
 * and matches nothing. Year 9999 stops on the last civil day this column stores.
 */
export function seriesReleaseYearFilter(year: number): Prisma.DateTimeFilter {
  if (year === 0) {
    return {
      gte: utcCivilDate(9999, 11, 31),
      lt: utcCivilDate(1, 0, 1),
    };
  }
  const start = utcCivilDate(year, 0, 1);
  if (year >= 9999) {
    return { gte: start, lte: utcCivilDate(9999, 11, 31) };
  }
  return { gte: start, lt: utcCivilDate(year + 1, 0, 1) };
}
