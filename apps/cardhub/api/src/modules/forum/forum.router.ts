import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  cursorPaginationInput,
  replyCreateInput,
  slugify,
  topicCreateInput,
  topicUpdateInput,
} from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';

// 5-minute window matches plan §M6 + handoff doc. Stored as ms so we can
// reuse it from tests without re-parsing strings.
const EDIT_WINDOW_MS = 5 * 60 * 1000;
const SLUG_RETRY_LIMIT = 5;

/**
 * Generate a unique slug by retrying on Prisma's P2002 unique-constraint
 * violation. The retry budget is small because the random suffix space is
 * 36^6 ≈ 2.2B — a clash within five attempts means the seed entropy is
 * broken and the failure should bubble.
 */
async function createTopicWithUniqueSlug(
  prisma: PrismaService,
  data: { title: string; body: string; userId: string },
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < SLUG_RETRY_LIMIT; attempt += 1) {
    const slug = slugify(data.title);
    try {
      return await prisma.topic.create({
        data: {
          slug,
          title: data.title,
          body: data.body,
          userId: data.userId,
        },
        include: { user: { select: { id: true, username: true } } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('failed to allocate unique topic slug');
}

export interface TopicAuthor {
  id: string;
  username: string;
}

function mapTopicSummary(topic: {
  id: string;
  slug: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: TopicAuthor;
  _count?: { replies: number };
}) {
  return {
    id: topic.id,
    slug: topic.slug,
    title: topic.title,
    body: topic.body,
    pinned: topic.pinned,
    createdAt: topic.createdAt.toISOString(),
    updatedAt: topic.updatedAt.toISOString(),
    author: topic.user,
    replyCount: topic._count?.replies ?? 0,
  };
}

@Injectable()
export class ForumRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    const topics = t.router({
      list: t.procedure.input(cursorPaginationInput).query(async ({ input }) => {
        // Cursor pagination keyed on (createdAt desc, id desc) so two topics
        // posted in the same millisecond stay deterministic. Cursor is the
        // last item's id; Prisma's cursor + skip:1 idiom translates that
        // into a stable seek even if pagination is interleaved with new
        // inserts.
        const items = await prisma.topic.findMany({
          take: input.limit + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: {
            user: { select: { id: true, username: true } },
            _count: { select: { replies: true } },
          },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;
        return {
          items: sliced.map(mapTopicSummary),
          nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
        };
      }),

      bySlug: t.procedure
        .input(z.object({ slug: z.string().min(1).max(96) }))
        .query(async ({ input }) => {
          const topic = await prisma.topic.findUnique({
            where: { slug: input.slug },
            include: {
              user: { select: { id: true, username: true } },
              _count: { select: { replies: true } },
            },
          });
          if (!topic) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '话题不存在' });
          }
          // Inline the first page of replies so /forum/:slug renders in
          // a single roundtrip; further pages stream via replies.list.
          const initialReplies = await prisma.reply.findMany({
            where: { topicId: topic.id },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 21,
            include: { user: { select: { id: true, username: true } } },
          });
          const hasMore = initialReplies.length > 20;
          const sliced = hasMore ? initialReplies.slice(0, 20) : initialReplies;
          return {
            ...mapTopicSummary(topic),
            replies: sliced.map((r) => ({
              id: r.id,
              body: r.body,
              createdAt: r.createdAt.toISOString(),
              author: r.user,
            })),
            replyNextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
          };
        }),

      create: t.authedProcedure.input(topicCreateInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const created = await createTopicWithUniqueSlug(prisma, {
          title: input.title,
          body: input.body,
          userId: ctx.user.sub,
        });
        return mapTopicSummary({ ...created, _count: { replies: 0 } });
      }),

      update: t.authedProcedure.input(topicUpdateInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const existing = await prisma.topic.findUnique({
          where: { id: input.id },
          select: { id: true, userId: true, createdAt: true },
        });
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: '话题不存在' });
        if (existing.userId !== ctx.user.sub) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '只能编辑自己的话题' });
        }
        if (Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '话题发布超过 5 分钟后无法编辑，可考虑删除后重新发布',
          });
        }
        const updated = await prisma.topic.update({
          where: { id: input.id },
          data: { title: input.title, body: input.body },
          include: {
            user: { select: { id: true, username: true } },
            _count: { select: { replies: true } },
          },
        });
        return mapTopicSummary(updated);
      }),

      delete: t.authedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const topic = await prisma.topic.findUnique({
            where: { id: input.id },
            select: { id: true, userId: true },
          });
          if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: '话题不存在' });
          if (topic.userId !== ctx.user.sub) {
            // Only re-fetch the role when the requester is not the owner —
            // the common case (owner deletes their own topic) avoids the
            // extra round-trip.
            const requester = await prisma.user.findUnique({
              where: { id: ctx.user.sub },
              select: { role: true },
            });
            if (requester?.role !== 'admin') {
              throw new TRPCError({ code: 'FORBIDDEN', message: '没有删除权限' });
            }
          }
          await prisma.topic.delete({ where: { id: input.id } });
          return { ok: true };
        }),
    });

    const replies = t.router({
      list: t.procedure
        .input(cursorPaginationInput.extend({ topicId: z.string().uuid() }))
        .query(async ({ input }) => {
          const items = await prisma.reply.findMany({
            where: { topicId: input.topicId },
            take: input.limit + 1,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
            include: { user: { select: { id: true, username: true } } },
          });
          const hasMore = items.length > input.limit;
          const sliced = hasMore ? items.slice(0, input.limit) : items;
          return {
            items: sliced.map((r) => ({
              id: r.id,
              body: r.body,
              createdAt: r.createdAt.toISOString(),
              author: r.user,
            })),
            nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
          };
        }),

      create: t.authedProcedure.input(replyCreateInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const topic = await prisma.topic.findUnique({
          where: { id: input.topicId },
          select: { id: true },
        });
        if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: '话题不存在' });
        const created = await prisma.reply.create({
          data: { topicId: input.topicId, userId: ctx.user.sub, body: input.body },
          include: { user: { select: { id: true, username: true } } },
        });
        return {
          id: created.id,
          body: created.body,
          createdAt: created.createdAt.toISOString(),
          author: created.user,
        };
      }),

      delete: t.authedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const reply = await prisma.reply.findUnique({
            where: { id: input.id },
            select: { id: true, userId: true },
          });
          if (!reply) throw new TRPCError({ code: 'NOT_FOUND', message: '回帖不存在' });
          if (reply.userId !== ctx.user.sub) {
            const requester = await prisma.user.findUnique({
              where: { id: ctx.user.sub },
              select: { role: true },
            });
            if (requester?.role !== 'admin') {
              throw new TRPCError({ code: 'FORBIDDEN', message: '没有删除权限' });
            }
          }
          await prisma.reply.delete({ where: { id: input.id } });
          return { ok: true };
        }),
    });

    return t.router({ topics, replies });
  }
}
