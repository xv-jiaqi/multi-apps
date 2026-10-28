import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  APP_ERROR_CODES,
  commentInput,
  commentRepliesListInput,
  isBlankReplyContent,
  optionalDeleteReason,
  seriesCommentInput,
  slugSchema,
} from '@repo/shared';
import { normalizeDeleteReason, writeContentDelete } from '../audit/content-delete';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { loadReplyPreviews, type ReplyPreview } from './reply-preview';

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

function parentGone(): TRPCError {
  return new TRPCError({
    code: 'NOT_FOUND',
    message: '这条评论已被删除，无法回复',
    cause: { appCode: APP_ERROR_CODES.COMMENT_PARENT_GONE },
  });
}

function blankReply(): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message: '写点内容再回复',
    cause: { appCode: APP_ERROR_CODES.VALIDATION },
  });
}

function isMissingParentFk(error: unknown): boolean {
  if (!(error instanceof PrismaClientKnownRequestError) || error.code !== 'P2003') return false;
  return JSON.stringify(error.meta ?? {}).includes('parentId');
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

    const userSelect = { select: { id: true, username: true } } as const;

    async function withReplies(where: Prisma.CommentWhereInput, limit: number) {
      const comments = await prisma.comment.findMany({
        where: { ...where, parentId: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: { user: userSelect },
      });
      const ids = comments.map((comment) => comment.id);
      if (ids.length === 0) return [];
      const [counts, replyRows] = await Promise.all([
        prisma.comment.groupBy({
          by: ['parentId'],
          where: { parentId: { in: ids } },
          _count: { _all: true },
        }),
        loadReplyPreviews(prisma, ids),
      ]);
      const countByParent = new Map(
        counts.map((row) => [row.parentId, row._count._all] as const),
      );
      const grouped = new Map<string, ReplyPreview[]>();
      for (const reply of replyRows) {
        const bucket = grouped.get(reply.parentId) ?? [];
        bucket.push(reply);
        grouped.set(reply.parentId, bucket);
      }
      return comments.map((comment) => {
        const shown = grouped.get(comment.id) ?? [];
        const replyCount = countByParent.get(comment.id) ?? 0;
        return {
          ...mapComment(comment),
          replyCount,
          replies: shown.map((reply) => ({
            id: reply.id,
            content: reply.content,
            createdAt: reply.createdAt.toISOString(),
            user: { id: reply.userId, username: reply.username },
          })),
          repliesNextCursor: replyCount > shown.length ? (shown.at(-1)?.id ?? null) : null,
        };
      });
    }

    async function assertReplyContent(parentId: string, content: string) {
      const trimmed = content.trim();
      if (!trimmed.startsWith('@')) return;
      const authors = await prisma.comment.findMany({
        where: { parentId },
        distinct: ['userId'],
        select: { user: { select: { username: true } } },
      });
      const names = authors.map((row) => row.user.username);
      if (isBlankReplyContent(trimmed, names)) throw blankReply();
    }

    async function requireTopLevel(
      parentId: string,
      scope: { cardId?: string; seriesId?: string },
    ) {
      const parent = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { id: true, parentId: true, cardId: true, seriesId: true },
      });
      if (!parent || parent.parentId !== null) throw parentGone();
      if (scope.cardId && parent.cardId !== scope.cardId) throw parentGone();
      if (scope.seriesId && parent.seriesId !== scope.seriesId) throw parentGone();
      return parent;
    }

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
          return withReplies({ cardId: card.id }, input.limit);
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
          return withReplies({ seriesId: series.id }, input.limit);
        }),

      listReplies: t.procedure.input(commentRepliesListInput).query(async ({ input }) => {
        const parent = await prisma.comment.findUnique({
          where: { id: input.parentId },
          select: { parentId: true },
        });
        if (!parent || parent.parentId !== null) return { items: [], nextCursor: null };
        if (input.cursor) {
          const cursorRow = await prisma.comment.findUnique({
            where: { id: input.cursor },
            select: { parentId: true },
          });
          if (!cursorRow || cursorRow.parentId !== input.parentId) {
            return { items: [], nextCursor: null };
          }
        }
        const limit = input.limit;
        const rows = await prisma.comment.findMany({
          where: { parentId: input.parentId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: { user: userSelect },
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        return {
          items: page.map(mapComment),
          nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
        };
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
        if (input.parentId) {
          await requireTopLevel(input.parentId, { cardId: card.id });
          await assertReplyContent(input.parentId, input.content);
        }

        try {
          const created = await prisma.comment.create({
            data: {
              content: input.content,
              cardId: card.id,
              userId: ctx.user.sub,
              ...(input.parentId ? { parentId: input.parentId } : {}),
            },
            include: { user: { select: { id: true, username: true } } },
          });
          return mapComment(created);
        } catch (error) {
          if (isMissingParentFk(error)) throw parentGone();
          throw error;
        }
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
          if (input.parentId) {
            await requireTopLevel(input.parentId, { seriesId: series.id });
            await assertReplyContent(input.parentId, input.content);
          }

          try {
            const created = await prisma.comment.create({
              data: {
                content: input.content,
                seriesId: series.id,
                userId: ctx.user.sub,
                ...(input.parentId ? { parentId: input.parentId } : {}),
              },
              include: { user: { select: { id: true, username: true } } },
            });
            return mapComment(created);
          } catch (error) {
            if (isMissingParentFk(error)) throw parentGone();
            throw error;
          }
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
