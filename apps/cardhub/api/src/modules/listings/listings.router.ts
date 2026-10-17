import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { z } from 'zod';
import { listingListInput, listingMineInput, listingPublishInput } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';

type ListingWithUser = Prisma.ListingGetPayload<{
  include: { user: { select: { id: true; username: true } } };
}>;

/**
 * Decimal -> string keeps tRPC's inferred type stable (tRPC 11 serialises
 * Decimal to string already, but typing the conversion explicitly
 * means the client never has to disambiguate `string | Decimal`).
 */
function mapListing(row: ListingWithUser) {
  return {
    id: row.id,
    cardSlug: row.cardSlug,
    kind: row.kind,
    price: row.price === null ? null : row.price.toFixed(2),
    currency: row.currency,
    imageUrls: row.imageUrls,
    contact: row.contact,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    seller: row.user ?? null,
  };
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
        // Default surface is "OPEN, newest first". Closed listings stay
        // browseable via listings.mine but don't pollute the public board.
        const where: Prisma.ListingWhereInput = {
          status: 'OPEN',
          ...(input.cardSlug ? { cardSlug: input.cardSlug } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
        };
        const items = await prisma.listing.findMany({
          where,
          take: input.limit + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: { user: { select: { id: true, username: true } } },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;
        return {
          items: sliced.map((row: ListingWithUser) => mapListing(row)),
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
          return items.map((row: ListingWithUser) => mapListing(row));
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
        return {
          items: sliced.map((row: ListingWithUser) => mapListing(row)),
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
          },
          include: { user: { select: { id: true, username: true } } },
        });
        return mapListing(created);
      }),

      close: t.authedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const existing = await prisma.listing.findUnique({
            where: { id: input.id },
            select: { id: true, userId: true, status: true },
          });
          if (!existing) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '该交易意向不存在' });
          }
          if (existing.userId !== ctx.user.sub) {
            // Mirror forum.delete — fall through to admin role check only
            // when ownership fails so the common case stays cheap.
            const requester = await prisma.user.findUnique({
              where: { id: ctx.user.sub },
              select: { role: true },
            });
            if (requester?.role !== 'admin') {
              throw new TRPCError({ code: 'FORBIDDEN', message: '只能关闭自己发布的意向' });
            }
          }
          if (existing.status === 'CLOSED') {
            return { ok: true };
          }
          await prisma.listing.update({
            where: { id: input.id },
            data: { status: 'CLOSED' },
          });
          return { ok: true };
        }),
    });
  }
}
