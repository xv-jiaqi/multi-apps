import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { seriesListInput, slugSchema } from '@repo/shared';
import { formatReleaseDate } from '../catalog/release-date';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import {
  listReleaseYears,
  publicSeriesSelect,
  readSeriesTimes,
  requireSeriesTimes,
  seriesListOrder,
  seriesListWhere,
  toPublicSeries,
} from './series-public';

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
      list: t.procedure.input(seriesListInput.optional()).query(async ({ input }) => {
        const page = input?.page ?? 1;
        const pageSize = input?.pageSize ?? 20;
        const where = seriesListWhere({
          categorySlug: input?.categorySlug,
          year: input?.year,
        });
        const [[items, total], years] = await Promise.all([
          prisma.$transaction([
            prisma.series.findMany({
              where,
              orderBy: seriesListOrder(input?.sort),
              skip: (page - 1) * pageSize,
              take: pageSize,
              select: publicSeriesSelect,
            }),
            prisma.series.count({ where }),
          ]),
          listReleaseYears(prisma),
        ]);
        const times = await readSeriesTimes(
          prisma,
          items.map((series) => series.id),
        );
        return {
          items: items.map((series) =>
            toPublicSeries(series, requireSeriesTimes(times, series.id)),
          ),
          page,
          pageSize,
          total,
          years,
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
            releaseDate: true,
            category: { select: { slug: true, name: true } },
            subsets: {
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { slug: 'asc' }],
              select: { slug: true, name: true, kind: true, sortOrder: true },
            },
            cards: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                slug: true,
                name: true,
                rarity: true,
                imageUrl: true,
                cardNumber: true,
                subset: { select: { slug: true } },
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
          releaseDate: formatReleaseDate(series.releaseDate),
          category: series.category
            ? { slug: series.category.slug, name: series.category.name }
            : null,
          subsets: series.subsets,
          cards: series.cards.map((card) => ({
            id: card.id,
            slug: card.slug,
            name: card.name,
            rarity: card.rarity,
            imageUrl: card.imageUrl,
            cardNumber: card.cardNumber,
            subsetSlug: card.subset?.slug ?? null,
          })),
        };
      }),
    });
  }
}
