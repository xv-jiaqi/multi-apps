import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import type { SeriesListSort } from '@repo/shared';
import { formatReleaseDate } from '../catalog/release-date';
import type { PrismaService } from '../prisma/prisma.service';

type SeriesTimes = { createdAt: string; updatedAt: string };

type SeriesTimeRow = {
  id: string;
  createdNonFinite: boolean;
  updatedNonFinite: boolean;
  createdYear: number | null;
  updatedYear: number | null;
  createdRest: string | null;
  updatedRest: string | null;
};

/**
 * Postgres `timestamp` accepts values Prisma's Date decoder cannot represent.
 * Selecting those columns makes `findUnique` throw, and `Date#toISOString()`
 * throws `Invalid time value`. Read the parts as text, then emit the same
 * string `Date#toISOString()` would: years outside 0000–9999 use a sign and
 * six digits (`+010000-...`). Postgres has no year 0, so 1 BC extracts as -1;
 * ECMAScript uses astronomical years, where that instant is 0000. Non-finite
 * values (`infinity`) are not instants, so the field stays `string` and the
 * request fails instead of returning null.
 */
function unrepresentableSeriesTime(): TRPCError {
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '系列时间无法表示' });
}

function asBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

function asYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

/** `EXTRACT(YEAR)` of 1 BC is -1. Astronomical year 0 is that same instant. */
function astronomicalYear(postgresYear: number): number {
  return postgresYear < 0 ? postgresYear + 1 : postgresYear;
}

function ecmaIsoTimestamp(year: number, monthDayTime: string): string {
  const absolute = Math.abs(year);
  const expanded = year < 0 || year > 9999;
  const yearText = expanded ? String(absolute).padStart(6, '0') : String(absolute).padStart(4, '0');
  const sign = year < 0 ? '-' : expanded ? '+' : '';
  const iso = `${sign}${yearText}-${monthDayTime}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw unrepresentableSeriesTime();
  return date.toISOString();
}

function seriesTimestamp(nonFinite: unknown, year: unknown, rest: string | null): string {
  const finiteYear = asYear(year);
  if (asBool(nonFinite) || finiteYear === null || !rest) throw unrepresentableSeriesTime();
  return ecmaIsoTimestamp(astronomicalYear(finiteYear), rest);
}

export async function readSeriesTimes(
  prisma: PrismaService,
  ids: string[],
): Promise<Map<string, SeriesTimes>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<SeriesTimeRow[]>`
    SELECT
      id,
      ("createdAt" = 'infinity'::timestamp OR "createdAt" = '-infinity'::timestamp) AS "createdNonFinite",
      ("updatedAt" = 'infinity'::timestamp OR "updatedAt" = '-infinity'::timestamp) AS "updatedNonFinite",
      CASE
        WHEN "createdAt" = 'infinity'::timestamp OR "createdAt" = '-infinity'::timestamp THEN NULL
        ELSE EXTRACT(YEAR FROM "createdAt")::int
      END AS "createdYear",
      CASE
        WHEN "updatedAt" = 'infinity'::timestamp OR "updatedAt" = '-infinity'::timestamp THEN NULL
        ELSE EXTRACT(YEAR FROM "updatedAt")::int
      END AS "updatedYear",
      CASE
        WHEN "createdAt" = 'infinity'::timestamp OR "createdAt" = '-infinity'::timestamp THEN NULL
        ELSE to_char("createdAt", 'MM-DD"T"HH24:MI:SS.MS')
      END AS "createdRest",
      CASE
        WHEN "updatedAt" = 'infinity'::timestamp OR "updatedAt" = '-infinity'::timestamp THEN NULL
        ELSE to_char("updatedAt", 'MM-DD"T"HH24:MI:SS.MS')
      END AS "updatedRest"
    FROM series
    WHERE id IN (${Prisma.join(ids)})
  `;
  return new Map(
    rows.map((row) => [
      row.id,
      {
        createdAt: seriesTimestamp(row.createdNonFinite, row.createdYear, row.createdRest),
        updatedAt: seriesTimestamp(row.updatedNonFinite, row.updatedYear, row.updatedRest),
      },
    ]),
  );
}

export function requireSeriesTimes(times: Map<string, SeriesTimes>, id: string): SeriesTimes {
  const stamped = times.get(id);
  if (!stamped) throw unrepresentableSeriesTime();
  return stamped;
}

type YearRow = { year: number | bigint | string | null };

/** Distinct release years, newest first. Independent of the list filters. */
export async function listReleaseYears(prisma: PrismaService): Promise<number[]> {
  const rows = await prisma.$queryRaw<YearRow[]>`
    SELECT DISTINCT EXTRACT(YEAR FROM "releaseDate")::int AS year
    FROM series
    WHERE "releaseDate" IS NOT NULL
    ORDER BY year DESC
  `;
  const years: number[] = [];
  for (const row of rows) {
    const year = asYear(row.year);
    if (year !== null) years.push(year);
  }
  return years;
}

export const publicSeriesSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  coverUrl: true,
  releaseDate: true,
  category: { select: { slug: true, name: true } },
  _count: { select: { cards: true } },
} as const;

export type PublicSeriesRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  releaseDate: Date | null;
  category: { slug: string; name: string } | null;
  _count: { cards: number };
};

export function toPublicSeries(series: PublicSeriesRow, times: SeriesTimes) {
  return {
    id: series.id,
    slug: series.slug,
    title: series.title,
    description: series.description,
    coverUrl: series.coverUrl,
    cardCount: series._count.cards,
    createdAt: times.createdAt,
    updatedAt: times.updatedAt,
    releaseDate: formatReleaseDate(series.releaseDate),
    category: series.category ? { slug: series.category.slug, name: series.category.name } : null,
  };
}

/**
 * Omitted sort stays `createdAt` ascending so existing clients, including the
 * miniapp, keep their current order. Release-date sorts put undated series last.
 */
export function seriesListOrder(
  sort: SeriesListSort | undefined,
): Prisma.SeriesOrderByWithRelationInput[] {
  if (sort === 'createdAtDesc') return [{ createdAt: 'desc' }];
  if (sort === 'releaseDateAsc') {
    return [{ releaseDate: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }, { slug: 'asc' }];
  }
  if (sort === 'releaseDateDesc') {
    return [{ releaseDate: { sort: 'desc', nulls: 'last' } }, { title: 'asc' }, { slug: 'asc' }];
  }
  return [{ createdAt: 'asc' }];
}

export function seriesListWhere(input: {
  categorySlug?: string;
  year?: number;
}): Prisma.SeriesWhereInput {
  const where: Prisma.SeriesWhereInput = {};
  if (input.categorySlug) where.category = { slug: input.categorySlug };
  if (input.year) {
    where.releaseDate = {
      gte: new Date(Date.UTC(input.year, 0, 1)),
      lt: new Date(Date.UTC(input.year + 1, 0, 1)),
    };
  }
  return where;
}
