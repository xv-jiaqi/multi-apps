import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { z } from 'zod';
import {
  forumRepliesListInput,
  markdownToPlainText,
  optionalDeleteReason,
  replyCreateInput,
  slugify,
  topicBySlugInput,
  topicCreateInput,
  topicListInput,
  topicSetPinnedInput,
  topicUpdateInput,
} from '@repo/shared';
import { aroundPageSkip } from '../../common/around-page';
import { normalizeDeleteReason, writeContentDelete } from '../audit/content-delete';
import { forumReplyHref, forumTopicHref } from '../notifications/href';
import { notificationExcerpt } from '../notifications/plan';
import { contentMayNotify, notifyAfterCommit, notifyContent } from '../notifications/notify';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { ContentSecurityService } from '../content-security/content-security.service';
import {
  isVisibleOnSurface,
  mergeSafetyStatus,
  publicSafetyWhere,
  resolveContentSurface,
  toSafetyStatusDto,
  type ContentSafetyStatusName,
} from '../content-security/visibility';

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
  data: { title: string; body: string; userId: string; safetyStatus: ContentSafetyStatusName },
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
          safetyStatus: data.safetyStatus,
        },
        include: { user: { select: { id: true, username: true } } },
      });
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
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

type TopicSummaryPayload = Prisma.TopicGetPayload<{
  include: {
    user: { select: { id: true; username: true } };
    _count: { select: { replies: true } };
  };
}>;

type ReplyWithAuthor = Prisma.ReplyGetPayload<{
  include: { user: { select: { id: true; username: true } } };
}>;

function mapTopicListItem(topic: TopicSummaryPayload) {
  return {
    id: topic.id,
    slug: topic.slug,
    title: topic.title,
    excerpt: markdownToPlainText(topic.body, 120),
    pinned: topic.pinned,
    editedAt: topic.editedAt?.toISOString() ?? null,
    createdAt: topic.createdAt.toISOString(),
    updatedAt: topic.updatedAt.toISOString(),
    author: topic.user,
    replyCount: topic._count?.replies ?? 0,
    safetyStatus: toSafetyStatusDto(topic.safetyStatus),
  };
}

function mapTopicDetail(topic: TopicSummaryPayload) {
  return {
    ...mapTopicListItem(topic),
    body: topic.body,
  };
}

@Injectable()
export class ForumRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
    private readonly contentSecurity: ContentSecurityService,
  ) {}

  build() {
    const t = this.t;
    // Per-user quota after auth, before input validation (CH-227).
    const topicCreateProcedure = t.activeUserProcedure.use(t.userRateLimit('forumTopicCreate'));
    const replyCreateProcedure = t.activeUserProcedure.use(t.userRateLimit('forumReplyCreate'));
    const prisma = this.prisma;
    const contentSecurity = this.contentSecurity;

    const topics = t.router({
      list: t.procedure.input(topicListInput).query(async ({ ctx, input }) => {
        // Cursor pagination keyed on (pinned desc, createdAt desc, id desc)
        // so pinned topics float without the client doing a second sort.
        const surface = resolveContentSurface(input.surface);
        const items = await prisma.topic.findMany({
          where: publicSafetyWhere({ surface, viewerId: ctx.user?.sub }),
          take: input.limit + 1,
          orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: {
            user: { select: { id: true, username: true } },
            _count: { select: { replies: true } },
          },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;
        return {
          items: sliced.map(mapTopicListItem),
          nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
        };
      }),

      bySlug: t.procedure.input(topicBySlugInput).query(async ({ ctx, input }) => {
        const topic = await prisma.topic.findUnique({
          where: { slug: input.slug },
          include: {
            user: { select: { id: true, username: true } },
            _count: { select: { replies: true } },
          },
        });
        const surface = resolveContentSurface(input.surface);
        if (
          !topic ||
          !isVisibleOnSurface({
            surface,
            status: topic.safetyStatus,
            authorId: topic.userId,
            viewerId: ctx.user?.sub,
          })
        ) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '话题不存在' });
        }
        // Inline the first page of replies so /forum/:slug renders in
        // a single roundtrip; further pages stream via replies.list.
        const replySafety = publicSafetyWhere({ surface, viewerId: ctx.user?.sub });
        const initialReplies = await prisma.reply.findMany({
          where: { topicId: topic.id, AND: [replySafety] },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 21,
          include: { user: { select: { id: true, username: true } } },
        });
        const hasMore = initialReplies.length > 20;
        const sliced = hasMore ? initialReplies.slice(0, 20) : initialReplies;
        const editableUntil = new Date(topic.createdAt.getTime() + EDIT_WINDOW_MS);
        return {
          ...mapTopicDetail(topic),
          editableUntil: editableUntil.toISOString(),
          serverNow: new Date().toISOString(),
          replies: sliced.map((r: ReplyWithAuthor) => ({
            id: r.id,
            body: r.body,
            createdAt: r.createdAt.toISOString(),
            author: r.user,
            safetyStatus: toSafetyStatusDto(r.safetyStatus),
          })),
          replyNextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
        };
      }),

      create: topicCreateProcedure.input(topicCreateInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const actorId = ctx.user.sub;
        const decision = await contentSecurity.evaluateWrite({
          actorId,
          scene: 3,
          texts: [input.title, input.body],
          targetType: 'TOPIC',
        });
        const created = await createTopicWithUniqueSlug(prisma, {
          title: input.title,
          body: input.body,
          userId: actorId,
          safetyStatus: decision.safetyStatus,
        });
        await contentSecurity.finalizeWrite({
          decision,
          actorId,
          targetType: 'TOPIC',
          targetId: created.id,
          scene: 3,
        });
        if (contentMayNotify(created.body, null, actorId)) {
          await notifyAfterCommit(() =>
            notifyContent(prisma, {
              actorId,
              body: created.body,
              excerpt: notificationExcerpt(created.body),
              targetType: 'TOPIC',
              targetId: created.id,
              href: forumTopicHref(created.slug),
              reply: null,
            }),
          );
        }
        return mapTopicDetail({ ...created, _count: { replies: 0 } });
      }),

      update: t.activeUserProcedure.input(topicUpdateInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const actorId = ctx.user.sub;
        const existing = await prisma.topic.findUnique({
          where: { id: input.id },
          select: { id: true, userId: true, createdAt: true, safetyStatus: true },
        });
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: '话题不存在' });
        if (existing.userId !== actorId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '只能编辑自己的话题' });
        }
        if (Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '话题发布超过 5 分钟后无法编辑，可考虑删除后重新发布',
          });
        }
        const decision = await contentSecurity.evaluateWrite({
          actorId,
          scene: 3,
          texts: [input.title, input.body],
          targetType: 'TOPIC',
        });
        const updated = await prisma.topic.update({
          where: { id: input.id },
          data: {
            title: input.title,
            body: input.body,
            editedAt: new Date(),
            safetyStatus: mergeSafetyStatus(existing.safetyStatus, decision.safetyStatus),
          },
          include: {
            user: { select: { id: true, username: true } },
            _count: { select: { replies: true } },
          },
        });
        await contentSecurity.finalizeWrite({
          decision,
          actorId,
          targetType: 'TOPIC',
          targetId: updated.id,
          scene: 3,
        });
        await notifyAfterCommit(() =>
          notifyContent(prisma, {
            actorId,
            body: updated.body,
            excerpt: notificationExcerpt(updated.body),
            targetType: 'TOPIC',
            targetId: updated.id,
            href: forumTopicHref(updated.slug),
            reply: null,
            dedupeMentions: true,
          }),
        );
        return mapTopicDetail(updated);
      }),

      setPinned: t.authedProcedure.input(topicSetPinnedInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const requester = await prisma.user.findUnique({
          where: { id: ctx.user.sub },
          select: { role: true },
        });
        if (requester?.role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: '只有管理员可以置顶话题' });
        }
        const topic = await prisma.topic.findUnique({
          where: { id: input.id },
          select: { id: true },
        });
        if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: '话题不存在' });
        const updated = await prisma.topic.update({
          where: { id: input.id },
          data: { pinned: input.pinned },
          include: {
            user: { select: { id: true, username: true } },
            _count: { select: { replies: true } },
          },
        });
        return mapTopicDetail(updated);
      }),

      delete: t.authedProcedure
        .input(z.object({ id: z.string().uuid(), reason: optionalDeleteReason }))
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const actor = ctx.user;
          const topic = await prisma.topic.findUnique({
            where: { id: input.id },
            select: { id: true, userId: true, title: true },
          });
          if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: '话题不存在' });
          const isSelf = topic.userId === actor.sub;
          if (!isSelf) {
            // Only re-fetch the role when the requester is not the owner —
            // the common case (owner deletes their own topic) avoids the
            // extra round-trip.
            const requester = await prisma.user.findUnique({
              where: { id: actor.sub },
              select: { role: true },
            });
            if (requester?.role !== 'admin') {
              throw new TRPCError({ code: 'FORBIDDEN', message: '没有删除权限' });
            }
          }
          if (isSelf) {
            await prisma.topic.delete({ where: { id: input.id } });
          } else {
            await prisma.$transaction(async (tx) => {
              await tx.topic.delete({ where: { id: input.id } });
              await writeContentDelete(tx, {
                actorId: actor.sub,
                actorUsername: actor.username,
                targetType: 'TOPIC',
                targetId: topic.id,
                targetLabel: topic.title,
                targetUserId: topic.userId,
                reason: normalizeDeleteReason(input.reason),
              });
            });
          }
          return { ok: true };
        }),
    });

    const replies = t.router({
      list: t.procedure.input(forumRepliesListInput).query(async ({ ctx, input }) => {
        const include = { user: { select: { id: true, username: true } } };
        const surface = resolveContentSurface(input.surface);
        const safety = publicSafetyWhere({ surface, viewerId: ctx.user?.sub });
        const mapPage = (rows: ReplyWithAuthor[]) => {
          const hasMore = rows.length > input.limit;
          const sliced = hasMore ? rows.slice(0, input.limit) : rows;
          return {
            items: sliced.map((r: ReplyWithAuthor) => ({
              id: r.id,
              body: r.body,
              createdAt: r.createdAt.toISOString(),
              author: r.user,
              safetyStatus: toSafetyStatusDto(r.safetyStatus),
            })),
            nextCursor: hasMore ? (sliced.at(-1)?.id ?? null) : null,
          };
        };

        if (input.aroundId) {
          const target = await prisma.reply.findFirst({
            where: { id: input.aroundId, topicId: input.topicId, AND: [safety] },
            select: { id: true, createdAt: true },
          });
          if (!target) return { items: [], nextCursor: null };
          const before = await prisma.reply.count({
            where: {
              topicId: input.topicId,
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
          const rows = await prisma.reply.findMany({
            where: { topicId: input.topicId, AND: [safety] },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            skip: aroundPageSkip(before, input.limit),
            take: input.limit + 1,
            include,
          });
          return mapPage(rows);
        }

        const items = await prisma.reply.findMany({
          where: { topicId: input.topicId, AND: [safety] },
          take: input.limit + 1,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include,
        });
        return mapPage(items);
      }),

      create: replyCreateProcedure.input(replyCreateInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const topic = await prisma.topic.findUnique({
          where: { id: input.topicId },
          select: { id: true, slug: true, userId: true },
        });
        if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: '话题不存在' });
        const actorId = ctx.user.sub;
        const decision = await contentSecurity.evaluateWrite({
          actorId,
          scene: 3,
          texts: [input.body],
          targetType: 'REPLY',
        });
        const created = await prisma.reply.create({
          data: {
            topicId: topic.id,
            userId: actorId,
            body: input.body,
            safetyStatus: decision.safetyStatus,
          },
          include: { user: { select: { id: true, username: true } } },
        });
        await contentSecurity.finalizeWrite({
          decision,
          actorId,
          targetType: 'REPLY',
          targetId: created.id,
          scene: 3,
        });
        await notifyAfterCommit(() =>
          notifyContent(prisma, {
            actorId,
            body: created.body,
            excerpt: notificationExcerpt(created.body),
            targetType: 'REPLY',
            targetId: created.id,
            href: forumReplyHref(topic.slug, created.id),
            reply: topic.userId === actorId ? null : { userId: topic.userId, type: 'TOPIC_REPLY' },
          }),
        );
        return {
          id: created.id,
          body: created.body,
          createdAt: created.createdAt.toISOString(),
          author: created.user,
          safetyStatus: toSafetyStatusDto(created.safetyStatus),
        };
      }),

      delete: t.authedProcedure
        .input(z.object({ id: z.string().uuid(), reason: optionalDeleteReason }))
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const actor = ctx.user;
          const reply = await prisma.reply.findUnique({
            where: { id: input.id },
            select: { id: true, userId: true, body: true },
          });
          if (!reply) throw new TRPCError({ code: 'NOT_FOUND', message: '回帖不存在' });
          const isSelf = reply.userId === actor.sub;
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
            await prisma.reply.delete({ where: { id: input.id } });
          } else {
            await prisma.$transaction(async (tx) => {
              await tx.reply.delete({ where: { id: input.id } });
              await writeContentDelete(tx, {
                actorId: actor.sub,
                actorUsername: actor.username,
                targetType: 'REPLY',
                targetId: reply.id,
                targetLabel: reply.body,
                targetUserId: reply.userId,
                reason: normalizeDeleteReason(input.reason),
              });
            });
          }
          return { ok: true };
        }),
    });

    return t.router({ topics, replies });
  }
}
