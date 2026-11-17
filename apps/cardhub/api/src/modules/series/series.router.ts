import { loadSeriesReleases, type SeriesRelease } from './series-releases';
import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { seriesBySlugInput, seriesListInput } from '@repo/shared';
import { formatReleaseDate } from '../catalog/release-date';
import { TrpcBase } from '../../trpc/trpc-base';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCache,
  DirectCatalogCache,
  seriesBySlugKey,
  seriesListCacheKey,
} from '../redis/catalog-cache';
import { seriesBySlugSchema, seriesListSchema } from '../redis/public-cache.schema';
import {
  listReleaseYears,
  publicSeriesSelect,
  readSeriesTimes,
  requireSeriesTimes,
  seriesListOrder,
  seriesListWhere,
  toPublicSeries,
} from './series-public';

const seriesMetaSelect = {
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
} satisfies Prisma.SeriesSelect;

function toSeriesMeta(
  series: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    coverUrl: string | null;
    releaseDate: Date | null;
    category: { slug: string; name: string } | null;
    subsets: Array<{ slug: string; name: string; kind: 'BASE' | 'INSERT'; sortOrder: number }>;
  },
  stamped: { createdAt: string; updatedAt: string },
) {
  return {
    id: series.id,
    slug: series.slug,
    title: series.title,
    description: series.description,
    coverUrl: series.coverUrl,
    createdAt: stamped.createdAt,
    updatedAt: stamped.updatedAt,
    releaseDate: formatReleaseDate(series.releaseDate),
    category: series.category ? { slug: series.category.slug, name: series.category.name } : null,
    subsets: series.subsets,
  };
}

type SeriesBySlugCard = {
  id: string;
  slug: string;
  name: string;
  rarity: string | null;
  imageUrl: string | null;
  cardNumber: string | null;
  subsetSlug: string | null;
  parallelName: string | null;
  printRun: number | null;
  parallelOfId: string | null;
};

type SeriesBySlugResult = ReturnType<typeof toSeriesMeta> & {
  baseCardCount: number;
  releases: SeriesRelease[];
  cards?: SeriesBySlugCard[];
};

@Injectable()
export class SeriesRouter {
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
      list: t.procedure.input(seriesListInput.optional()).query(({ input }) => {
        return cache.read(seriesListCacheKey(input), seriesListSchema, async () => {
          const page = input?.page ?? 1;
          const pageSize = input?.pageSize ?? 20;
          const where = seriesListWhere({
            categorySlug: input?.categorySlug,
            year: input?.year,
            releasedOnOrBefore: input?.releasedOnOrBefore,
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
        });
      }),

      bySlug: t.procedure
        .input(seriesBySlugInput)
        .query(async ({ input }): Promise<SeriesBySlugResult> => {
          const includeCards = input.includeCards !== false;
          if (!includeCards) {
            const series = await prisma.series.findUnique({
              where: { slug: input.slug },
              select: seriesMetaSelect,
            });
            if (!series) {
              throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' });
            }
            const [stamped, baseCardCount, releases] = await Promise.all([
              requireSeriesTimes(await readSeriesTimes(prisma, [series.id]), series.id),
              prisma.card.count({ where: { seriesId: series.id, parallelOfId: null } }),
              loadSeriesReleases(prisma, series.id),
            ]);
            return { ...toSeriesMeta(series, stamped), baseCardCount, releases, cards: undefined };
          }

          const detail = await cache.read(
            seriesBySlugKey(input.slug),
            seriesBySlugSchema,
            async () => {
              const series = await prisma.series.findUnique({
                where: { slug: input.slug },
                select: {
                  ...seriesMetaSelect,
                  // Pending removal. The miniapp and admin still read this full
                  // list in createdAt order. The web series page passes
                  // includeCards: false and uses cards.listBySeries instead.
                  cards: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                      id: true,
                      slug: true,
                      name: true,
                      rarity: true,
                      imageUrl: true,
                      cardNumber: true,
                      parallelName: true,
                      printRun: true,
                      parallelOfId: true,
                      subset: { select: { slug: true } },
                    },
                  },
                },
              });
              if (!series) {
                throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' });
              }
              const stamped = requireSeriesTimes(
                await readSeriesTimes(prisma, [series.id]),
                series.id,
              );
              const cards = series.cards.map((card) => ({
                id: card.id,
                slug: card.slug,
                name: card.name,
                rarity: card.rarity,
                imageUrl: card.imageUrl,
                cardNumber: card.cardNumber,
                subsetSlug: card.subset?.slug ?? null,
                parallelName: card.parallelName,
                printRun: card.printRun,
                parallelOfId: card.parallelOfId,
              }));
              return {
                ...toSeriesMeta(series, stamped),
                cards,
                baseCardCount: cards.filter((card) => card.parallelOfId == null).length,
              };
            },
          );
          const releases = await loadSeriesReleases(prisma, detail.id);
          return { ...detail, releases };
        }),
    });
  }
}
