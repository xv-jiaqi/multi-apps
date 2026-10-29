import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { hasCardSearchConditions, parseCardSearchQuery, slugSchema } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogCache, DirectCatalogCache, cardBySlugKey } from '../redis/catalog-cache';
import { cardBySlugSchema } from '../redis/public-cache.schema';
import { assertParsedSearch, buildCardSearchWhere } from '../search/search-query';

type CardSearchRow = Prisma.CardGetPayload<{
  include: { series: { select: { slug: true; title: true } } };
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
        return cache.read(cardBySlugKey(input.slug), cardBySlugSchema, async () => {
          const card = await prisma.card.findUnique({
            where: { slug: input.slug },
            include: {
              series: { select: { slug: true, title: true } },
              subset: { select: { slug: true, name: true, kind: true } },
            },
          });
          if (!card) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '卡牌不存在' });
          }
          // Prisma's JsonValue is recursive and blows up TS instantiation
          // depth on the client. Surface attributes as a flat dictionary so
          // tRPC's inferred output stays cheap to type-check.
          const attributes =
            card.attributes &&
            typeof card.attributes === 'object' &&
            !Array.isArray(card.attributes)
              ? (card.attributes as Record<string, string | number | boolean | null>)
              : null;
          return {
            id: card.id,
            slug: card.slug,
            name: card.name,
            description: card.description,
            imageUrl: card.imageUrl,
            rarity: card.rarity,
            attributes,
            seriesSlug: card.series.slug,
            seriesTitle: card.series.title,
            cardNumber: card.cardNumber ?? null,
            subset: card.subset
              ? { slug: card.subset.slug, name: card.subset.name, kind: card.subset.kind }
              : null,
            createdAt: card.createdAt.toISOString(),
            updatedAt: card.updatedAt.toISOString(),
          };
        });
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
            include: { series: { select: { slug: true, title: true } } },
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
            })),
          };
        }),
    });
  }
}
