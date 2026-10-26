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

type SeriesTimes = { createdAt: string | null; updatedAt: string | null };

/**
 * Postgres `timestamp` accepts values Prisma's Date decoder cannot represent
 * (`infinity`, and some years such as 10000, which come back as an invalid
 * Date). Selecting those columns makes `findUnique` throw, and `toISOString()`
 * throws `Invalid time value`. Read them as text instead.
 */
async function readSeriesTimes(
  prisma: PrismaService,
  ids: string[],
): Promise<Map<string, SeriesTimes>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    Array<{ id: string; createdAt: string | null; updatedAt: string | null }>
  >`
    SELECT
      id,
      CASE
        WHEN "createdAt" = 'infinity'::timestamp OR "createdAt" = '-infinity'::timestamp THEN NULL
        ELSE NULLIF(btrim(to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), '')
      END AS "createdAt",
      CASE
        WHEN "updatedAt" = 'infinity'::timestamp OR "updatedAt" = '-infinity'::timestamp THEN NULL
        ELSE NULLIF(btrim(to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), '')
      END AS "updatedAt"
    FROM series
    WHERE id IN (${Prisma.join(ids)})
  `;
  return new Map(
    rows.map((row) => [
      row.id,
      {
        createdAt: row.createdAt?.trim() ? row.createdAt : null,
        updatedAt: row.updatedAt?.trim() ? row.updatedAt : null,
      },
    ]),
  );
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
            const stamped = times.get(series.id);
            return {
              id: series.id,
              slug: series.slug,
              title: series.title,
              description: series.description,
              coverUrl: series.coverUrl,
              cardCount: series._count.cards,
              createdAt: stamped?.createdAt ?? null,
              updatedAt: stamped?.updatedAt ?? null,
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
        const stamped = (await readSeriesTimes(prisma, [series.id])).get(series.id);
        return {
          id: series.id,
          slug: series.slug,
          title: series.title,
          description: series.description,
          coverUrl: series.coverUrl,
          createdAt: stamped?.createdAt ?? null,
          updatedAt: stamped?.updatedAt ?? null,
          cards: series.cards,
        };
      }),
    });
  }
}
