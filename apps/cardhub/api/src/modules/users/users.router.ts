import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { myContentPageInput, type ContentSurface } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import {
  authorSafetyStatus,
  blockedSafetyStatus,
  ownerSafetyWhere,
  resolveContentSurface,
  resolveSafetyView,
} from '../content-security/visibility';

type OwnerVisibility = { viewerId: string; surface: ContentSurface };

type MyTopicRow = Prisma.TopicGetPayload<{
  include: { _count: { select: { replies: true } } };
}>;

type MyCommentRow = Prisma.CommentGetPayload<{
  include: {
    card: { select: { slug: true; name: true; imageUrl: true } };
    series: { select: { slug: true; title: true } };
  };
}>;

/**
 * "My" lists show every row to its author and nothing to anyone else
 * (`scope: 'owner'`). A RISKY row keeps only `safetyStatus: 'blocked'`;
 * its text fields become '' because they are required strings in the
 * existing contract. Returns [] for a row the viewer may not see.
 */
function mapMyTopic(topic: MyTopicRow, visibility: OwnerVisibility) {
  const view = resolveSafetyView({
    scope: 'owner',
    surface: visibility.surface,
    status: topic.safetyStatus,
    authorId: topic.userId,
    viewerId: visibility.viewerId,
  });
  if (view.kind === 'hidden') return [];
  const base = {
    id: topic.id,
    // The slug still routes the author to the blocked detail view. It holds
    // only the ASCII part of the title (see `slugify`).
    slug: topic.slug,
    createdAt: topic.createdAt.toISOString(),
  };
  if (view.kind === 'blocked') {
    return [{ ...base, title: '', replyCount: 0, safetyStatus: blockedSafetyStatus() }];
  }
  return [
    {
      ...base,
      title: topic.title,
      replyCount: topic._count.replies,
      safetyStatus: authorSafetyStatus(view.safetyStatus),
    },
  ];
}

function mapMyComment(comment: MyCommentRow, visibility: OwnerVisibility) {
  const view = resolveSafetyView({
    scope: 'owner',
    surface: visibility.surface,
    status: comment.safetyStatus,
    authorId: comment.userId,
    viewerId: visibility.viewerId,
  });
  if (view.kind === 'hidden') return [];
  return [mapMyCommentTarget(comment, view)];
}

function mapMyCommentTarget(
  comment: MyCommentRow,
  view: Exclude<ReturnType<typeof resolveSafetyView>, { kind: 'hidden' }>,
) {
  const base =
    view.kind === 'blocked'
      ? {
          id: comment.id,
          body: '',
          createdAt: comment.createdAt.toISOString(),
          safetyStatus: blockedSafetyStatus(),
        }
      : {
          id: comment.id,
          body: comment.content,
          createdAt: comment.createdAt.toISOString(),
          safetyStatus: authorSafetyStatus(view.safetyStatus),
        };
  if (comment.card) {
    return {
      ...base,
      cardSlug: comment.card.slug,
      cardName: comment.card.name,
      cardImageUrl: comment.card.imageUrl,
      target: {
        kind: 'card' as const,
        slug: comment.card.slug,
        name: comment.card.name,
        imageUrl: comment.card.imageUrl,
      },
    };
  }
  if (comment.series) {
    return {
      ...base,
      cardSlug: null,
      cardName: null,
      cardImageUrl: null,
      target: {
        kind: 'series' as const,
        slug: comment.series.slug,
        title: comment.series.title,
      },
    };
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '评论目标缺失' });
}

@Injectable()
export class UsersRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      me: t.authedProcedure.query(async ({ ctx }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const user = await prisma.user.findUnique({
          where: { id: ctx.user.sub },
          select: { id: true, email: true, username: true, role: true, createdAt: true },
        });
        if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' });

        const [listingCount, listingTotalCount, topicCount, replyCount, commentCount] =
          await Promise.all([
            prisma.listing.count({ where: { userId: user.id, status: 'OPEN' } }),
            prisma.listing.count({ where: { userId: user.id } }),
            prisma.topic.count({ where: { userId: user.id } }),
            prisma.reply.count({ where: { userId: user.id } }),
            prisma.comment.count({ where: { userId: user.id } }),
          ]);

        return {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
          listingCount,
          listingTotalCount,
          topicCount,
          replyCount,
          commentCount,
        };
      }),

      myTopics: t.authedProcedure.input(myContentPageInput).query(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const surface = resolveContentSurface(input.surface, ctx.surfaceHeader);
        const pageCursor = input.pageCursor ?? input.cursor;
        const items = await prisma.topic.findMany({
          where: { userId: ctx.user.sub, ...ownerSafetyWhere({ surface }) },
          take: input.limit + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(pageCursor ? { cursor: { id: pageCursor }, skip: 1 } : {}),
          include: { _count: { select: { replies: true } } },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;
        const visibility = { viewerId: ctx.user.sub, surface };
        return {
          items: sliced.flatMap((topic: MyTopicRow) => mapMyTopic(topic, visibility)),
          nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
        };
      }),

      myComments: t.authedProcedure.input(myContentPageInput).query(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const surface = resolveContentSurface(input.surface, ctx.surfaceHeader);
        const pageCursor = input.pageCursor ?? input.cursor;
        const items = await prisma.comment.findMany({
          where: { userId: ctx.user.sub, ...ownerSafetyWhere({ surface }) },
          take: input.limit + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(pageCursor ? { cursor: { id: pageCursor }, skip: 1 } : {}),
          include: {
            card: { select: { slug: true, name: true, imageUrl: true } },
            series: { select: { slug: true, title: true } },
          },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;
        const visibility = { viewerId: ctx.user.sub, surface };
        return {
          items: sliced.flatMap((comment: MyCommentRow) => mapMyComment(comment, visibility)),
          nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
        };
      }),
    });
  }
}
