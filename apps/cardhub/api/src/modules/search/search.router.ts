import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hasCardSearchConditions, parseCardSearchQuery, relevanceSearchTerm } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { assertParsedSearch, buildCardSearchWhere, buildSeriesSearchWhere } from './search-query';
import { sortByRelevance } from './search-relevance';

/** Columns the relevance order needs (CH-241 §1). No body, no image. */
const rankSelect = {
  id: true,
  name: true,
  slug: true,
  rarity: true,
  cardNumber: true,
  createdAt: true,
  parallelOfId: true,
  parallelName: true,
  printRun: true,
  subset: { select: { sortOrder: true } },
  series: { select: { slug: true, releaseDate: true } },
} satisfies Prisma.CardSelect;

const pageInclude = {
  series: { select: { slug: true, title: true } },
  parallelOf: { select: { slug: true, name: true } },
  subset: { select: { slug: true, name: true } },
} satisfies Prisma.CardInclude;

type GlobalCardRow = Prisma.CardGetPayload<{
  omit: { body: true };
  include: typeof pageInclude;
}>;

type GlobalSeriesRow = Prisma.SeriesGetPayload<{
  include: { _count: { select: { cards: { where: { parallelOfId: null } } } } };
}>;

/** Generous: 10,000 pages of 50 cards is far beyond the catalog. */
export const SEARCH_CARD_PAGE_MAX = 10_000;

const globalSearchInput = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(20),
  cardLimit: z.number().int().min(1).max(50).optional(),
  seriesLimit: z.number().int().min(1).max(20).optional(),
  /** CH-241 §1: 1-based page of the card results. Omitted means 1. */
  cardPage: z.number().int().min(1).max(SEARCH_CARD_PAGE_MAX).default(1),
});

function toGlobalCard(card: GlobalCardRow) {
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    seriesSlug: card.series.slug,
    seriesTitle: card.series.title,
    parallelName: card.parallelName ?? null,
    printRun: card.printRun ?? null,
    isParallel: card.parallelOfId != null,
    base: card.parallelOf ? { slug: card.parallelOf.slug, name: card.parallelOf.name } : null,
    cardNumber: card.cardNumber ?? null,
    subsetSlug: card.subset?.slug ?? null,
    subsetName: card.subset?.name ?? null,
  };
}

@Injectable()
export class SearchRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    /**
     * CH-241 §1: rank every match in process, then read only the page rows.
     * Two card queries whatever the result size. The ranking read selects
     * narrow columns; the order is total (ends on id), so pages never repeat
     * or skip a card and `cardTotal` is the full match count.
     */
    async function loadCardPage(
      where: Prisma.CardWhereInput,
      term: string | undefined,
      cardPage: number,
      cardLimit: number,
    ) {
      const matches = await prisma.card.findMany({ where, select: rankSelect });
      const start = (cardPage - 1) * cardLimit;
      const pageIds = sortByRelevance(matches, term)
        .slice(start, start + cardLimit)
        .map((card) => card.id);
      if (pageIds.length === 0) return { cards: [], cardTotal: matches.length };

      const rows = await prisma.card.findMany({
        where: { id: { in: pageIds } },
        omit: { body: true },
        include: pageInclude,
      });
      const byId = new Map(rows.map((row: GlobalCardRow) => [row.id, row]));
      const cards = pageIds.flatMap((id) => {
        const row = byId.get(id);
        return row ? [toGlobalCard(row)] : [];
      });
      return { cards, cardTotal: matches.length };
    }

    return t.router({
      global: t.procedure.input(globalSearchInput).query(async ({ input }) => {
        const parsed = assertParsedSearch(parseCardSearchQuery(input.q));
        if (!hasCardSearchConditions(parsed)) {
          return {
            query: input.q,
            cards: [],
            cardTotal: 0,
            cardPage: input.cardPage,
            series: [],
          };
        }
        const cardLimit = input.cardLimit ?? input.limit;
        const seriesLimit = input.seriesLimit ?? input.limit;
        const shouldSearchSeries = Boolean(parsed.seriesSlug) || parsed.includeGroups.length > 0;

        const [cardResult, series] = await Promise.all([
          loadCardPage(
            buildCardSearchWhere(parsed),
            relevanceSearchTerm(parsed),
            input.cardPage,
            cardLimit,
          ),
          shouldSearchSeries
            ? prisma.series.findMany({
                where: buildSeriesSearchWhere(parsed),
                include: { _count: { select: { cards: { where: { parallelOfId: null } } } } },
                take: seriesLimit,
                orderBy: { title: 'asc' },
              })
            : Promise.resolve([]),
        ]);

        return {
          query: input.q,
          cards: cardResult.cards,
          cardTotal: cardResult.cardTotal,
          cardPage: input.cardPage,
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
