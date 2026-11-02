import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  cardsListBySeriesInput,
  hasCardSearchConditions,
  parseCardSearchQuery,
  slugSchema,
} from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCache,
  DirectCatalogCache,
  cardBySlugKey,
  cardsListBySeriesCacheKey,
} from '../redis/catalog-cache';
import { cardBySlugSchema, cardsListBySeriesSchema } from '../redis/public-cache.schema';
import { assertParsedSearch, buildCardSearchWhere } from '../search/search-query';
import { loadCardBySlug } from './card-by-slug';
import { loadCardsBySeries } from './list-by-series';

type CardSearchRow = Prisma.CardGetPayload<{
  include: {
    series: { select: { slug: true; title: true } };
    parallelOf: { select: { slug: true; name: true } };
  };
}>;

@Injectable()
export class CardsRouter {
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
      bySlug: t.procedure.input(z.object({ slug: slugSchema })).query(({ input }) => {
        return cache.read(cardBySlugKey(input.slug), cardBySlugSchema, () =>
          loadCardBySlug(prisma, input.slug),
        );
      }),

      search: t.procedure
        .input(
          z.object({
            q: z.string().trim().min(1).max(200),
            limit: z.number().int().min(1).max(50).default(20),
            rarity: z.enum(['common', 'rare', 'epic', 'legendary']).optional(),
            seriesSlug: slugSchema.optional(),
          }),
        )
        .query(async ({ input }) => {
          const parsed = assertParsedSearch(parseCardSearchQuery(input.q));
          const effectiveParsed = {
            ...parsed,
            ...(input.rarity ? { rarity: input.rarity } : {}),
            ...(input.seriesSlug ? { seriesSlug: input.seriesSlug } : {}),
          };
          if (!hasCardSearchConditions(effectiveParsed)) {
            return { query: input.q, results: [] };
          }
          const where = buildCardSearchWhere(effectiveParsed);
          const cards = await prisma.card.findMany({
            where,
            omit: { body: true },
            include: {
              series: { select: { slug: true, title: true } },
              parallelOf: { select: { slug: true, name: true } },
            },
            take: input.limit,
            orderBy: { name: 'asc' },
          });
          return {
            query: input.q,
            results: cards.map((c: CardSearchRow) => ({
              id: c.id,
              slug: c.slug,
              name: c.name,
              rarity: c.rarity,
              imageUrl: c.imageUrl,
              seriesSlug: c.series.slug,
              seriesTitle: c.series.title,
              parallelName: c.parallelName ?? null,
              printRun: c.printRun ?? null,
              isParallel: c.parallelOfId != null,
              base: c.parallelOf ? { slug: c.parallelOf.slug, name: c.parallelOf.name } : null,
            })),
          };
        }),

      listBySeries: t.procedure.input(cardsListBySeriesInput).query(({ input }) => {
        return cache.read(cardsListBySeriesCacheKey(input), cardsListBySeriesSchema, () =>
          loadCardsBySeries(prisma, input),
        );
      }),
    });
  }
}
