import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { slugSchema, paginationSchema } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';

type SeriesListRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  _count: { cards: number };
};

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

async function readSeriesTimes(
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

function requireSeriesTimes(times: Map<string, SeriesTimes>, id: string): SeriesTimes {
  const stamped = times.get(id);
  if (!stamped) throw unrepresentableSeriesTime();
  return stamped;
}

@Injectable()
export class SeriesRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      list: t.procedure.input(paginationSchema.optional()).query(async ({ input }) => {
        const { page = 1, pageSize = 20 } = input ?? {};
        const [items, total] = await prisma.$transaction([
          prisma.series.findMany({
            orderBy: { createdAt: 'asc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
              id: true,
              slug: true,
              title: true,
              description: true,
              coverUrl: true,
              _count: { select: { cards: true } },
            },
          }),
          prisma.series.count(),
        ]);
        const times = await readSeriesTimes(
          prisma,
          items.map((series: SeriesListRow) => series.id),
        );
        return {
          items: items.map((series: SeriesListRow) => {
            const stamped = requireSeriesTimes(times, series.id);
            return {
              id: series.id,
              slug: series.slug,
              title: series.title,
              description: series.description,
              coverUrl: series.coverUrl,
              cardCount: series._count.cards,
              createdAt: stamped.createdAt,
              updatedAt: stamped.updatedAt,
            };
          }),
          page,
          pageSize,
          total,
        };
      }),

      bySlug: t.procedure.input(z.object({ slug: slugSchema })).query(async ({ input }) => {
        const series = await prisma.series.findUnique({
          where: { slug: input.slug },
          select: {
            id: true,
            slug: true,
            title: true,
            description: true,
            coverUrl: true,
            cards: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                slug: true,
                name: true,
                rarity: true,
                imageUrl: true,
              },
            },
          },
        });
        if (!series) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' });
        }
        const stamped = requireSeriesTimes(await readSeriesTimes(prisma, [series.id]), series.id);
        return {
          id: series.id,
          slug: series.slug,
          title: series.title,
          description: series.description,
          coverUrl: series.coverUrl,
          createdAt: stamped.createdAt,
          updatedAt: stamped.updatedAt,
          cards: series.cards,
        };
      }),
    });
  }
}
