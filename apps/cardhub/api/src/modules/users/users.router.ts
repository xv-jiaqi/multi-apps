import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { pageCursorPaginationInput } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';

type MyTopicRow = Prisma.TopicGetPayload<{
  include: { _count: { select: { replies: true } } };
}>;

type MyCommentRow = Prisma.CommentGetPayload<{
  include: {
    card: { select: { slug: true; name: true; imageUrl: true } };
    series: { select: { slug: true; title: true } };
  };
}>;

function mapMyComment(comment: MyCommentRow) {
  const base = {
    id: comment.id,
    body: comment.content,
    createdAt: comment.createdAt.toISOString(),
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

      myTopics: t.authedProcedure.input(pageCursorPaginationInput).query(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const pageCursor = input.pageCursor ?? input.cursor;
        const items = await prisma.topic.findMany({
          where: { userId: ctx.user.sub },
          take: input.limit + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(pageCursor ? { cursor: { id: pageCursor }, skip: 1 } : {}),
          include: { _count: { select: { replies: true } } },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;
        return {
          items: sliced.map((topic: MyTopicRow) => ({
            id: topic.id,
            slug: topic.slug,
            title: topic.title,
            replyCount: topic._count.replies,
            createdAt: topic.createdAt.toISOString(),
          })),
          nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
        };
      }),

      myComments: t.authedProcedure
        .input(pageCursorPaginationInput)
        .query(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const pageCursor = input.pageCursor ?? input.cursor;
          const items = await prisma.comment.findMany({
            where: { userId: ctx.user.sub },
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
          return {
            items: sliced.map(mapMyComment),
            nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
          };
        }),
    });
  }
}
