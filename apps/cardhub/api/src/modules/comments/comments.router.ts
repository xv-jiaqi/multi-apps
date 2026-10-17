import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { commentInput, slugSchema } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';

type CommentWithUser = Prisma.CommentGetPayload<{
  include: { user: { select: { id: true; username: true } } };
}>;

@Injectable()
export class CommentsRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      listForCard: t.procedure
        .input(
          z.object({
            cardSlug: slugSchema,
            limit: z.number().int().min(1).max(100).default(50),
          }),
        )
        .query(async ({ input }) => {
          const card = await prisma.card.findUnique({
            where: { slug: input.cardSlug },
            select: { id: true },
          });
          if (!card) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '卡牌不存在' });
          }

          const comments = await prisma.comment.findMany({
            where: { cardId: card.id },
            orderBy: { createdAt: 'desc' },
            take: input.limit,
            include: { user: { select: { id: true, username: true } } },
          });

          return comments.map((c: CommentWithUser) => ({
            id: c.id,
            content: c.content,
            createdAt: c.createdAt.toISOString(),
            user: c.user,
          }));
        }),

      create: t.authedProcedure.input(commentInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) {
          throw new TRPCError({ code: 'UNAUTHORIZED' });
        }
        const card = await prisma.card.findUnique({
          where: { slug: input.cardSlug },
          select: { id: true },
        });
        if (!card) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '卡牌不存在' });
        }

        const created = await prisma.comment.create({
          data: {
            content: input.content,
            cardId: card.id,
            userId: ctx.user.sub,
          },
          include: { user: { select: { id: true, username: true } } },
        });

        return {
          id: created.id,
          content: created.content,
          createdAt: created.createdAt.toISOString(),
          user: created.user,
        };
      }),

      delete: t.authedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
          }

          const comment = await prisma.comment.findUnique({
            where: { id: input.id },
            select: { id: true, userId: true },
          });
          if (!comment) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '评论不存在' });
          }

          if (comment.userId !== ctx.user.sub) {
            const requester = await prisma.user.findUnique({
              where: { id: ctx.user.sub },
              select: { role: true },
            });
            if (requester?.role !== 'admin') {
              throw new TRPCError({ code: 'FORBIDDEN', message: '没有删除权限' });
            }
          }

          await prisma.comment.delete({ where: { id: input.id } });
          return { ok: true };
        }),
    });
  }
}
