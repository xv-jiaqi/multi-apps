import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { slugSchema } from '@repo/shared';
import { z } from 'zod';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCache,
  DirectCatalogCache,
  categoriesListKey,
  categoryBySlugKey,
} from '../redis/catalog-cache';
import { categoriesListSchema, categoryBySlugSchema } from '../redis/public-cache.schema';
import {
  publicSeriesSelect,
  readSeriesTimes,
  requireSeriesTimes,
  toPublicSeries,
} from '../series/series-public';

@Injectable()
export class CategoriesRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
    private readonly cache: CatalogCache = new DirectCatalogCache(),
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;
    const cache = this.cache;

    return t.router({
      list: t.procedure.query(() => {
        return cache.read(categoriesListKey(), categoriesListSchema, async () => {
          const items = await prisma.category.findMany({
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { slug: 'asc' }],
            select: {
              id: true,
              slug: true,
              name: true,
              description: true,
              sortOrder: true,
              _count: { select: { series: true } },
            },
          });
          return {
            items: items.map((category) => ({
              id: category.id,
              slug: category.slug,
              name: category.name,
              description: category.description,
              sortOrder: category.sortOrder,
              seriesCount: category._count.series,
            })),
          };
        });
      }),

      bySlug: t.procedure.input(z.object({ slug: slugSchema })).query(({ input }) => {
        return cache.read(categoryBySlugKey(input.slug), categoryBySlugSchema, async () => {
          const category = await prisma.category.findUnique({
            where: { slug: input.slug },
            select: {
              id: true,
              slug: true,
              name: true,
              description: true,
              sortOrder: true,
              series: {
                orderBy: [
                  { releaseDate: { sort: 'desc', nulls: 'last' } },
                  { title: 'asc' },
                  { slug: 'asc' },
                ],
                select: publicSeriesSelect,
              },
            },
          });
          if (!category) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '品类不存在' });
          }
          const times = await readSeriesTimes(
            prisma,
            category.series.map((series) => series.id),
          );
          return {
            id: category.id,
            slug: category.slug,
            name: category.name,
            description: category.description,
            sortOrder: category.sortOrder,
            series: category.series.map((series) =>
              toPublicSeries(series, requireSeriesTimes(times, series.id)),
            ),
          };
        });
      }),
    });
  }
}
