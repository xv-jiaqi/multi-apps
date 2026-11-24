import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  APP_ERROR_CODES,
  commentInput,
  commentRepliesListInput,
  contentSurfaceSchema,
  isBlankReplyContent,
  optionalDeleteReason,
  seriesCommentInput,
  slugSchema,
  type ContentSurface,
} from '@repo/shared';
import { aroundPageSkip } from '../../common/around-page';
import { normalizeDeleteReason, writeContentDelete } from '../audit/content-delete';
import { commentHref } from '../notifications/href';
import { notificationExcerpt } from '../notifications/plan';
import { contentMayNotify, notifyAfterCommit, notifyContent } from '../notifications/notify';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { ContentSecurityService } from '../content-security/content-security.service';
import {
  publicSafetyWhere,
  resolveContentSurface,
  contentPublicForNotify,
  resolveSafetyView,
  toSafetyStatusDto,
  type ContentSafetyStatusName,
} from '../content-security/visibility';
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
    safetyStatus: toSafetyStatusDto(c.safetyStatus),
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

/**
 * Whether this viewer may see a top-level comment, and so its replies.
 * Public scope: RISKY is hidden for everyone (the author's blocked view is
 * not a thread to read or answer), REVIEW only for its author, UNCHECKED
 * hidden on miniapp. The comment's card / series has no safety status, so
 * the parent row is the whole check.
 */
function parentVisible(
  parent: { userId: string; safetyStatus: ContentSafetyStatusName },
  visibility: { surface: ContentSurface; viewerId?: string | null },
): boolean {
  return (
    resolveSafetyView({
      scope: 'public',
      surface: visibility.surface,
      status: parent.safetyStatus,
      authorId: parent.userId,
      viewerId: visibility.viewerId,
    }).kind === 'visible'
  );
}

@Injectable()
export class CommentsRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
    private readonly contentSecurity: ContentSecurityService,
  ) {}

  build() {
    const t = this.t;
    // Per-user quota after auth, before input validation (CH-227).
    const commentCreateProcedure = t.activeUserProcedure.use(t.userRateLimit('commentCreate'));
    const prisma = this.prisma;
    const contentSecurity = this.contentSecurity;

    const userSelect = { select: { id: true, username: true } } as const;

    async function withReplies(
      where: Prisma.CommentWhereInput,
      limit: number,
      visibility: { surface: ReturnType<typeof resolveContentSurface>; viewerId?: string | null },
    ) {
      const safety = publicSafetyWhere({
        surface: visibility.surface,
        viewerId: visibility.viewerId,
      });
      const comments = await prisma.comment.findMany({
        where: { ...where, parentId: null, AND: [safety] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: { user: userSelect },
      });
      const ids = comments.map((comment) => comment.id);
      if (ids.length === 0) return [];
      const [counts, replyRows] = await Promise.all([
        prisma.comment.groupBy({
          by: ['parentId'],
          where: { parentId: { in: ids }, AND: [safety] },
          _count: { _all: true },
        }),
        loadReplyPreviews(prisma, ids, visibility),
      ]);
      const countByParent = new Map(counts.map((row) => [row.parentId, row._count._all] as const));
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

    /**
     * A parent this viewer cannot see answers like a deleted one (same
     * NOT_FOUND / COMMENT_PARENT_GONE), so a reply cannot probe for it.
     */
    async function requireTopLevel(
      parentId: string,
      scope: { cardId?: string; seriesId?: string },
      visibility: { surface: ContentSurface; viewerId: string },
    ) {
      const parent = await prisma.comment.findUnique({
        where: { id: parentId },
        select: {
          id: true,
          parentId: true,
          cardId: true,
          seriesId: true,
          userId: true,
          safetyStatus: true,
        },
      });
      // One throw site, so a hidden parent's error matches a missing one exactly.
      if (
        !parent ||
        parent.parentId !== null ||
        (scope.cardId && parent.cardId !== scope.cardId) ||
        (scope.seriesId && parent.seriesId !== scope.seriesId) ||
        !parentVisible(parent, visibility)
      ) {
        throw parentGone();
      }
      return parent;
    }

    async function insertComment(input: {
      content: string;
      userId: string;
      cardId?: string;
      seriesId?: string;
      /** The parent comment for a reply, `null` for a top-level comment. */
      parent: { id: string; safetyStatus: ContentSafetyStatusName } | null;
      replyUserId: string | null;
      kind: 'card' | 'series';
      slug: string;
    }) {
      const decision = await contentSecurity.evaluateWrite({
        actorId: input.userId,
        scene: 2,
        texts: [input.content],
        targetType: 'COMMENT',
      });
      const row = await prisma.comment.create({
        data: {
          content: input.content,
          userId: input.userId,
          safetyStatus: decision.safetyStatus,
          ...(input.cardId ? { cardId: input.cardId } : {}),
          ...(input.seriesId ? { seriesId: input.seriesId } : {}),
          ...(input.parent ? { parentId: input.parent.id } : {}),
        },
        include: { user: { select: { id: true, username: true } } },
      });
      await contentSecurity.finalizeWrite({
        decision,
        actorId: input.userId,
        targetType: 'COMMENT',
        targetId: row.id,
        scene: 2,
      });
      const replyUserId =
        input.replyUserId && input.replyUserId !== input.userId ? input.replyUserId : null;
      const isPublic = input.parent
        ? contentPublicForNotify(row.safetyStatus, input.parent.safetyStatus)
        : contentPublicForNotify(row.safetyStatus);
      if (isPublic && contentMayNotify(row.content, replyUserId, input.userId)) {
        await notifyAfterCommit(() =>
          notifyContent(prisma, {
            actorId: input.userId,
            body: row.content,
            excerpt: notificationExcerpt(row.content),
            targetType: 'COMMENT',
            targetId: row.id,
            href: commentHref(input.kind, input.slug, row.id, input.parent?.id ?? null),
            reply: replyUserId ? { userId: replyUserId, type: 'COMMENT_REPLY' } : null,
          }),
        );
      }
      return row;
    }

    return t.router({
      listForCard: t.procedure
        .input(
          z.object({
            cardSlug: slugSchema,
            limit: z.number().int().min(1).max(100).default(50),
            surface: contentSurfaceSchema.optional(),
          }),
        )
        .query(async ({ ctx, input }) => {
          const card = await prisma.card.findUnique({
            where: { slug: input.cardSlug },
            select: { id: true },
          });
          if (!card) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '卡牌不存在' });
          }
          return withReplies({ cardId: card.id }, input.limit, {
            surface: resolveContentSurface(input.surface, ctx.surfaceHeader),
            viewerId: ctx.user?.sub,
          });
        }),

      listForSeries: t.procedure
        .input(
          z.object({
            seriesSlug: slugSchema,
            limit: z.number().int().min(1).max(100).default(50),
            surface: contentSurfaceSchema.optional(),
          }),
        )
        .query(async ({ ctx, input }) => {
          const series = await prisma.series.findUnique({
            where: { slug: input.seriesSlug },
            select: { id: true },
          });
          if (!series) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' });
          }
          return withReplies({ seriesId: series.id }, input.limit, {
            surface: resolveContentSurface(input.surface, ctx.surfaceHeader),
            viewerId: ctx.user?.sub,
          });
        }),

      listReplies: t.procedure.input(commentRepliesListInput).query(async ({ ctx, input }) => {
        const surface = resolveContentSurface(input.surface, ctx.surfaceHeader);
        const viewerId = ctx.user?.sub;
        // Missing, not top-level, or hidden from this viewer: one empty page,
        // so the list cannot leak replies or tell a hidden parent from none.
        const parent = await prisma.comment.findUnique({
          where: { id: input.parentId },
          select: { parentId: true, userId: true, safetyStatus: true },
        });
        if (!parent || parent.parentId !== null || !parentVisible(parent, { surface, viewerId })) {
          return { items: [], nextCursor: null };
        }
        const safety = publicSafetyWhere({ surface, viewerId });

        const mapPage = (rows: CommentWithUser[]) => {
          const hasMore = rows.length > input.limit;
          const page = hasMore ? rows.slice(0, input.limit) : rows;
          return {
            items: page.map(mapComment),
            nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
          };
        };

        if (input.aroundId) {
          const target = await prisma.comment.findFirst({
            where: { id: input.aroundId, parentId: input.parentId, AND: [safety] },
            select: { id: true, createdAt: true },
          });
          if (!target) return { items: [], nextCursor: null };
          const before = await prisma.comment.count({
            where: {
              parentId: input.parentId,
              AND: [
                safety,
                {
                  OR: [
                    { createdAt: { lt: target.createdAt } },
                    { AND: [{ createdAt: target.createdAt }, { id: { lt: target.id } }] },
                  ],
                },
              ],
            },
          });
          const rows = await prisma.comment.findMany({
            where: { parentId: input.parentId, AND: [safety] },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            skip: aroundPageSkip(before, input.limit),
            take: input.limit + 1,
            include: { user: userSelect },
          });
          return mapPage(rows);
        }

        if (input.cursor) {
          const cursorRow = await prisma.comment.findUnique({
            where: { id: input.cursor },
            select: { parentId: true },
          });
          if (!cursorRow || cursorRow.parentId !== input.parentId) {
            return { items: [], nextCursor: null };
          }
        }
        const rows = await prisma.comment.findMany({
          where: { parentId: input.parentId, AND: [safety] },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: { user: userSelect },
        });
        return mapPage(rows);
      }),

      create: commentCreateProcedure.input(commentInput).mutation(async ({ ctx, input }) => {
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
        const parent = input.parentId
          ? await requireTopLevel(
              input.parentId,
              { cardId: card.id },
              {
                surface: resolveContentSurface(undefined, ctx.surfaceHeader),
                viewerId: ctx.user.sub,
              },
            )
          : null;
        if (input.parentId) await assertReplyContent(input.parentId, input.content);

        try {
          const created = await insertComment({
            content: input.content,
            userId: ctx.user.sub,
            cardId: card.id,
            parent: parent ? { id: parent.id, safetyStatus: parent.safetyStatus } : null,
            replyUserId: parent && typeof parent.userId === 'string' ? parent.userId : null,
            kind: 'card',
            slug: input.cardSlug,
          });
          return mapComment(created);
        } catch (error) {
          if (isMissingParentFk(error)) throw parentGone();
          throw error;
        }
      }),

      createForSeries: commentCreateProcedure
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
          const parent = input.parentId
            ? await requireTopLevel(
                input.parentId,
                { seriesId: series.id },
                {
                  surface: resolveContentSurface(undefined, ctx.surfaceHeader),
                  viewerId: ctx.user.sub,
                },
              )
            : null;
          if (input.parentId) await assertReplyContent(input.parentId, input.content);

          try {
            const created = await insertComment({
              content: input.content,
              userId: ctx.user.sub,
              seriesId: series.id,
              parent: parent ? { id: parent.id, safetyStatus: parent.safetyStatus } : null,
              replyUserId: parent && typeof parent.userId === 'string' ? parent.userId : null,
              kind: 'series',
              slug: input.seriesSlug,
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
