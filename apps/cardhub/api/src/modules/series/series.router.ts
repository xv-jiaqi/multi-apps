import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { slugSchema, paginationSchema } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';

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
      list: t.procedure.input(paginationSchema.optional()).query(async ({ input }) => {
        const { page = 1, pageSize = 20 } = input ?? {};
        const [items, total] = await prisma.$transaction([
          prisma.series.findMany({
            orderBy: { createdAt: 'asc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: { _count: { select: { cards: true } } },
          }),
          prisma.series.count(),
        ]);
        return {
          items: items.map((s) => ({
            id: s.id,
            slug: s.slug,
            title: s.title,
            description: s.description,
            coverUrl: s.coverUrl,
            cardCount: s._count.cards,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          })),
          page,
          pageSize,
          total,
        };
      }),

      bySlug: t.procedure.input(z.object({ slug: slugSchema })).query(async ({ input }) => {
        const series = await prisma.series.findUnique({
          where: { slug: input.slug },
          include: {
            cards: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                slug: true,
                name: true,
                rarity: true,
                imageUrl: true,
              },
            },
          },
        });
        if (!series) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' });
        }
        return {
          id: series.id,
          slug: series.slug,
          title: series.title,
          description: series.description,
          coverUrl: series.coverUrl,
          createdAt: series.createdAt.toISOString(),
          updatedAt: series.updatedAt.toISOString(),
          cards: series.cards,
        };
      }),
    });
  }
}
