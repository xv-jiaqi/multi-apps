import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { z } from 'zod';
import {
  listingListInput,
  listingMineInput,
  listingPublishInput,
  optionalDeleteReason,
} from '@repo/shared';
import { normalizeDeleteReason, writeContentDelete } from '../audit/content-delete';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';

type ListingWithUser = Prisma.ListingGetPayload<{
  include: { user: { select: { id: true; username: true } } };
}>;

type ListingCardSummary = {
  slug: string;
  name: string;
  imageUrl: string | null;
  seriesSlug: string;
  seriesTitle: string;
};

/**
 * Decimal -> string keeps tRPC's inferred type stable (tRPC 11 serialises
 * Decimal to string already, but typing the conversion explicitly
 * means the client never has to disambiguate `string | Decimal`).
 */
function mapListing(
  row: ListingWithUser,
  cardsBySlug: Map<string, ListingCardSummary> = new Map(),
) {
  return {
    id: row.id,
    cardSlug: row.cardSlug,
    card: cardsBySlug.get(row.cardSlug) ?? null,
    kind: row.kind,
    price: row.price === null ? null : row.price.toFixed(2),
    currency: row.currency,
    imageUrls: row.imageUrls,
    contact: row.contact,
    note: row.note,
    condition: row.condition,
    language: row.language,
    variantNote: row.variantNote,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    seller: row.user ?? null,
  };
}

async function loadListingCards(prisma: PrismaService, cardSlugs: string[]) {
  const uniqueSlugs = [...new Set(cardSlugs)];
  if (uniqueSlugs.length === 0) return new Map<string, ListingCardSummary>();

  const cards = await prisma.card.findMany({
    where: { slug: { in: uniqueSlugs } },
    select: {
      slug: true,
      name: true,
      imageUrl: true,
      series: { select: { slug: true, title: true } },
    },
  });

  return new Map(
    cards.map((card) => [
      card.slug,
      {
        slug: card.slug,
        name: card.name,
        imageUrl: card.imageUrl,
        seriesSlug: card.series.slug,
        seriesTitle: card.series.title,
      },
    ]),
  );
}

@Injectable()
export class ListingsRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      list: t.procedure.input(listingListInput).query(async ({ input }) => {
        const usesPriceFilter = input.minPrice !== undefined || input.maxPrice !== undefined;
        const usesPriceSort = input.sort === 'price_asc' || input.sort === 'price_desc';
        if ((usesPriceFilter || usesPriceSort) && !input.currency) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'trade.filter.priceNeedsCurrency',
          });
        }

        // Default surface is "OPEN, newest first". Closed listings stay
        // browseable via listings.mine but don't pollute the public board.
        // Currency alone (newest, no min/max) still narrows the board.
        // Price ranges and price sorts additionally drop unpriced rows.
        const where: Prisma.ListingWhereInput = {
          status: 'OPEN',
          ...(input.cardSlug ? { cardSlug: input.cardSlug } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.condition ? { condition: input.condition } : {}),
          ...(input.language ? { language: input.language } : {}),
          ...(input.currency ? { currency: input.currency } : {}),
          ...(usesPriceFilter || usesPriceSort
            ? {
                price: {
                  not: null,
                  ...(input.minPrice !== undefined
                    ? { gte: new Decimal(input.minPrice.toString()) }
                    : {}),
                  ...(input.maxPrice !== undefined
                    ? { lte: new Decimal(input.maxPrice.toString()) }
                    : {}),
                },
              }
            : {}),
        };
        const orderBy: Prisma.ListingOrderByWithRelationInput[] =
          input.sort === 'price_asc'
            ? [{ price: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]
            : input.sort === 'price_desc'
              ? [{ price: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
              : [{ createdAt: 'desc' }, { id: 'desc' }];
        const items = await prisma.listing.findMany({
          where,
          take: input.limit + 1,
          orderBy,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: { user: { select: { id: true, username: true } } },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;
        const cardsBySlug = await loadListingCards(
          prisma,
          sliced.map((row) => row.cardSlug),
        );
        return {
          items: sliced.map((row: ListingWithUser) => mapListing(row, cardsBySlug)),
          nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
        };
      }),

      byCard: t.procedure
        .input(
          z.object({
            cardSlug: z.string().min(1).max(96),
            limit: z.number().int().min(1).max(20).default(5),
          }),
        )
        .query(async ({ input }) => {
          // Card-detail page uses this to surface "trade intents for this
          // card" inline. We only show OPEN listings — closed deals are
          // historical noise on the card page.
          const items = await prisma.listing.findMany({
            where: { cardSlug: input.cardSlug, status: 'OPEN' },
            take: input.limit,
            orderBy: [{ createdAt: 'desc' }],
            include: { user: { select: { id: true, username: true } } },
          });
          const cardsBySlug = await loadListingCards(
            prisma,
            items.map((row) => row.cardSlug),
          );
          return items.map((row: ListingWithUser) => mapListing(row, cardsBySlug));
        }),

      mine: t.authedProcedure.input(listingMineInput).query(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const pageCursor = input.pageCursor ?? input.cursor;
        const items = await prisma.listing.findMany({
          where: { userId: ctx.user.sub },
          take: input.limit + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(pageCursor ? { cursor: { id: pageCursor }, skip: 1 } : {}),
          include: { user: { select: { id: true, username: true } } },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;
        const cardsBySlug = await loadListingCards(
          prisma,
          sliced.map((row) => row.cardSlug),
        );
        return {
          items: sliced.map((row: ListingWithUser) => mapListing(row, cardsBySlug)),
          nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
        };
      }),

      publish: t.authedProcedure.input(listingPublishInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        // Sanity check the cardSlug exists at publish time so users do
        // not post listings for typos. We do not lock the relation
        // (cardSlug is intentionally a soft pointer — see schema comment)
        // but we want the immediate UX feedback.
        const card = await prisma.card.findUnique({
          where: { slug: input.cardSlug },
          select: { id: true },
        });
        if (!card) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: '找不到对应的卡牌，请检查 slug',
          });
        }
        const created = await prisma.listing.create({
          data: {
            userId: ctx.user.sub,
            cardSlug: input.cardSlug,
            kind: input.kind,
            price: input.price === undefined ? null : new Decimal(input.price.toString()),
            currency: input.currency,
            imageUrls: input.imageUrls,
            contact: input.contact,
            note: input.note ?? null,
            condition: input.condition ?? null,
            language: input.language ?? null,
            variantNote: input.variantNote ?? null,
          },
          include: { user: { select: { id: true, username: true } } },
        });
        const cardsBySlug = await loadListingCards(prisma, [created.cardSlug]);
        return mapListing(created, cardsBySlug);
      }),

      close: t.authedProcedure
        .input(z.object({ id: z.string().uuid(), reason: optionalDeleteReason }))
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const actor = ctx.user;
          const existing = await prisma.listing.findUnique({
            where: { id: input.id },
            select: { id: true, userId: true, status: true, cardSlug: true },
          });
          if (!existing) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '该交易意向不存在' });
          }
          const isSelf = existing.userId === actor.sub;
          if (!isSelf) {
            // Mirror forum.delete — fall through to admin role check only
            // when ownership fails so the common case stays cheap.
            const requester = await prisma.user.findUnique({
              where: { id: actor.sub },
              select: { role: true },
            });
            if (requester?.role !== 'admin') {
              throw new TRPCError({ code: 'FORBIDDEN', message: '只能关闭自己发布的意向' });
            }
          }
          if (existing.status === 'CLOSED') {
            return { ok: true };
          }
          if (isSelf) {
            await prisma.listing.update({
              where: { id: input.id },
              data: { status: 'CLOSED' },
            });
          } else {
            await prisma.$transaction(async (tx) => {
              await tx.listing.update({
                where: { id: input.id },
                data: { status: 'CLOSED' },
              });
              await writeContentDelete(tx, {
                actorId: actor.sub,
                actorUsername: actor.username,
                targetType: 'LISTING',
                targetId: existing.id,
                targetLabel: existing.cardSlug,
                targetUserId: existing.userId,
                reason: normalizeDeleteReason(input.reason),
              });
            });
          }
          return { ok: true };
        }),
    });
  }
}
