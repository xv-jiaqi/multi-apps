import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { slugSchema } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';

type CardSearchRow = Prisma.CardGetPayload<{
  include: { series: { select: { slug: true; title: true } } };
}>;

@Injectable()
export class CardsRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      bySlug: t.procedure.input(z.object({ slug: slugSchema })).query(async ({ input }) => {
        const card = await prisma.card.findUnique({
          where: { slug: input.slug },
          include: {
            series: { select: { slug: true, title: true } },
          },
        });
        if (!card) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '卡牌不存在' });
        }
        // Prisma's JsonValue is recursive and blows up TS instantiation
        // depth on the client. Surface attributes as a flat dictionary so
        // tRPC's inferred output stays cheap to type-check.
        const attributes =
          card.attributes && typeof card.attributes === 'object' && !Array.isArray(card.attributes)
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
          createdAt: card.createdAt.toISOString(),
          updatedAt: card.updatedAt.toISOString(),
        };
      }),

      search: t.procedure
        .input(
          z.object({
            q: z.string().trim().min(1).max(80),
            limit: z.number().int().min(1).max(50).default(20),
          }),
        )
        .query(async ({ input }) => {
          // Postgres ILIKE = case-insensitive, also unicode-friendly so this
          // handles 中英 search out of the box (FR1 + Story 2.4 acceptance #3).
          const cards = await prisma.card.findMany({
            where: { name: { contains: input.q, mode: 'insensitive' } },
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
