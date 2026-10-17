import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hasCardSearchConditions, parseCardSearchQuery } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { assertParsedSearch, buildCardSearchWhere, buildSeriesSearchWhere } from './search-query';

type GlobalCardRow = Prisma.CardGetPayload<{
  include: { series: { select: { slug: true; title: true } } };
}>;

type GlobalSeriesRow = Prisma.SeriesGetPayload<{
  include: { _count: { select: { cards: true } } };
}>;

const globalSearchInput = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(20),
  cardLimit: z.number().int().min(1).max(50).optional(),
  seriesLimit: z.number().int().min(1).max(20).optional(),
});

@Injectable()
export class SearchRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      global: t.procedure.input(globalSearchInput).query(async ({ input }) => {
        const parsed = assertParsedSearch(parseCardSearchQuery(input.q));
        if (!hasCardSearchConditions(parsed)) {
          return { query: input.q, cards: [], series: [] };
        }
        const cardLimit = input.cardLimit ?? input.limit;
        const seriesLimit = input.seriesLimit ?? input.limit;
        const shouldSearchSeries = Boolean(parsed.seriesSlug) || parsed.includeGroups.length > 0;

        const [cards, series] = await Promise.all([
          prisma.card.findMany({
            where: buildCardSearchWhere(parsed),
            include: { series: { select: { slug: true, title: true } } },
            take: cardLimit,
            orderBy: { name: 'asc' },
          }),
          shouldSearchSeries
            ? prisma.series.findMany({
                where: buildSeriesSearchWhere(parsed),
                include: { _count: { select: { cards: true } } },
                take: seriesLimit,
                orderBy: { title: 'asc' },
              })
            : Promise.resolve([]),
        ]);

        return {
          query: input.q,
          cards: cards.map((card: GlobalCardRow) => ({
            id: card.id,
            slug: card.slug,
            name: card.name,
            rarity: card.rarity,
            imageUrl: card.imageUrl,
            seriesSlug: card.series.slug,
            seriesTitle: card.series.title,
          })),
          series: series.map((item: GlobalSeriesRow) => ({
            id: item.id,
            slug: item.slug,
            title: item.title,
            description: item.description,
            coverUrl: item.coverUrl,
            cardCount: item._count.cards,
          })),
        };
      }),
    });
  }
}
