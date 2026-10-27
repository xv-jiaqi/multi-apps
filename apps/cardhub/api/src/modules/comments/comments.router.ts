import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { commentInput, optionalDeleteReason, seriesCommentInput, slugSchema } from '@repo/shared';
import { normalizeDeleteReason, writeContentDelete } from '../audit/content-delete';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';

type CommentWithUser = Prisma.CommentGetPayload<{
  include: { user: { select: { id: true; username: true } } };
}>;

function mapComment(c: CommentWithUser) {
  return {
    id: c.id,
    content: c.content,
    createdAt: c.createdAt.toISOString(),
    user: c.user,
  };
}

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

          return comments.map(mapComment);
        }),

      listForSeries: t.procedure
        .input(
          z.object({
            seriesSlug: slugSchema,
            limit: z.number().int().min(1).max(100).default(50),
          }),
        )
        .query(async ({ input }) => {
          const series = await prisma.series.findUnique({
            where: { slug: input.seriesSlug },
            select: { id: true },
          });
          if (!series) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' });
          }

          const comments = await prisma.comment.findMany({
            where: { seriesId: series.id },
            orderBy: { createdAt: 'desc' },
            take: input.limit,
            include: { user: { select: { id: true, username: true } } },
          });

          return comments.map(mapComment);
        }),

      create: t.activeUserProcedure.input(commentInput).mutation(async ({ ctx, input }) => {
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

        return mapComment(created);
      }),

      createForSeries: t.activeUserProcedure
        .input(seriesCommentInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
          }
          const series = await prisma.series.findUnique({
            where: { slug: input.seriesSlug },
            select: { id: true },
          });
          if (!series) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' });
          }

          const created = await prisma.comment.create({
            data: {
              content: input.content,
              seriesId: series.id,
              userId: ctx.user.sub,
            },
            include: { user: { select: { id: true, username: true } } },
          });

          return mapComment(created);
        }),

      delete: t.authedProcedure
        .input(z.object({ id: z.string().uuid(), reason: optionalDeleteReason }))
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
          }
          const actor = ctx.user;

          const comment = await prisma.comment.findUnique({
            where: { id: input.id },
            select: { id: true, userId: true, content: true },
          });
          if (!comment) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '评论不存在' });
          }

          const isSelf = comment.userId === actor.sub;
          if (!isSelf) {
            const requester = await prisma.user.findUnique({
              where: { id: actor.sub },
              select: { role: true },
            });
            if (requester?.role !== 'admin') {
              throw new TRPCError({ code: 'FORBIDDEN', message: '没有删除权限' });
            }
          }

          if (isSelf) {
            await prisma.comment.delete({ where: { id: input.id } });
          } else {
            await prisma.$transaction(async (tx) => {
              await tx.comment.delete({ where: { id: input.id } });
              await writeContentDelete(tx, {
                actorId: actor.sub,
                actorUsername: actor.username,
                targetType: 'COMMENT',
                targetId: comment.id,
                targetLabel: comment.content,
                targetUserId: comment.userId,
                reason: normalizeDeleteReason(input.reason),
              });
            });
          }
          return { ok: true };
        }),
    });
  }
}
