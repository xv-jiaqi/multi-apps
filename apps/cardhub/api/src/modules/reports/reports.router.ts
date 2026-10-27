import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import {
  APP_ERROR_CODES,
  reportCreateInput,
  reportListInput,
  reportResolveInput,
} from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { writeReportResolve } from '../audit/content-delete';

type ReportWithReporter = Prisma.ReportGetPayload<{
  include: {
    reporter: { select: { id: true; username: true } };
    resolver: { select: { id: true; username: true } };
  };
}>;

type AdminRequester = { id: string; role: string } | null;

async function assertReportTargetExists(
  prisma: PrismaService,
  targetType: 'LISTING' | 'TOPIC' | 'REPLY' | 'COMMENT',
  targetId: string,
) {
  switch (targetType) {
    case 'LISTING': {
      const listing = await prisma.listing.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!listing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '举报目标不存在或已被删除' });
      }
      return;
    }
    case 'TOPIC': {
      const topic = await prisma.topic.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!topic) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '举报目标不存在或已被删除' });
      }
      return;
    }
    case 'REPLY': {
      const reply = await prisma.reply.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!reply) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '举报目标不存在或已被删除' });
      }
      return;
    }
    case 'COMMENT': {
      const comment = await prisma.comment.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!comment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '举报目标不存在或已被删除' });
      }
    }
  }
}

async function getAdminRequester(prisma: PrismaService, userId: string): Promise<AdminRequester> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
}

function assertAdmin(requester: AdminRequester, message: string) {
  if (requester?.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message });
  }
}

async function removeReportedTarget(
  tx: Prisma.TransactionClient,
  targetType: 'LISTING' | 'TOPIC' | 'REPLY' | 'COMMENT',
  targetId: string,
): Promise<void> {
  switch (targetType) {
    case 'LISTING':
      await tx.listing.update({ where: { id: targetId }, data: { status: 'CLOSED' } });
      return;
    case 'TOPIC':
      await tx.topic.delete({ where: { id: targetId } });
      return;
    case 'REPLY':
      await tx.reply.delete({ where: { id: targetId } });
      return;
    case 'COMMENT':
      await tx.comment.delete({ where: { id: targetId } });
      return;
  }
}

async function reportedAuthor(
  tx: Prisma.TransactionClient,
  targetType: 'LISTING' | 'TOPIC' | 'REPLY' | 'COMMENT',
  targetId: string,
): Promise<{ found: boolean; userId: string | null }> {
  const select = { userId: true } as const;
  const row =
    targetType === 'LISTING'
      ? await tx.listing.findUnique({ where: { id: targetId }, select })
      : targetType === 'TOPIC'
        ? await tx.topic.findUnique({ where: { id: targetId }, select })
        : targetType === 'REPLY'
          ? await tx.reply.findUnique({ where: { id: targetId }, select })
          : await tx.comment.findUnique({ where: { id: targetId }, select });
  if (!row) return { found: false, userId: null };
  return { found: true, userId: row.userId };
}

@Injectable()
export class ReportsRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      create: t.activeUserProcedure.input(reportCreateInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        // Per-user per-day quota is enforced at the procedure level so
        // express-rate-limit doesn't have to sniff the bearer token; 10
        // is generous enough for legitimate moderation reports while
        // still curbing report-flood griefing.
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recent = await prisma.report.count({
          where: { reporterId: ctx.user.sub, createdAt: { gte: since } },
        });
        if (recent >= 10) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: '今日举报次数已达上限，请明天再试',
            cause: { appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS },
          });
        }
        await assertReportTargetExists(prisma, input.targetType, input.targetId);
        const created = await prisma.report.create({
          data: {
            reporterId: ctx.user.sub,
            targetType: input.targetType,
            targetId: input.targetId,
            reason: input.reason,
          },
        });
        return {
          id: created.id,
          createdAt: created.createdAt.toISOString(),
        };
      }),

      list: t.authedProcedure.input(reportListInput).query(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        // Re-fetch the role rather than trusting it from ctx — admin
        // demotion should take effect immediately on the next call.
        const requester = await getAdminRequester(prisma, ctx.user.sub);
        assertAdmin(requester, '仅管理员可查看举报队列');
        const items = await prisma.report.findMany({
          where: { ...(input.status ? { status: input.status } : {}) },
          take: input.limit + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: {
            reporter: { select: { id: true, username: true } },
            resolver: { select: { id: true, username: true } },
          },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;

        const listingIds = sliced.filter((r) => r.targetType === 'LISTING').map((r) => r.targetId);
        const topicIds = sliced.filter((r) => r.targetType === 'TOPIC').map((r) => r.targetId);
        const replyIds = sliced.filter((r) => r.targetType === 'REPLY').map((r) => r.targetId);
        const commentIds = sliced.filter((r) => r.targetType === 'COMMENT').map((r) => r.targetId);

        const [listings, topics, replies, comments] = await Promise.all([
          listingIds.length > 0
            ? prisma.listing.findMany({
                where: { id: { in: listingIds } },
                select: {
                  id: true,
                  cardSlug: true,
                  status: true,
                  user: { select: { username: true } },
                },
              })
            : Promise.resolve([]),
          topicIds.length > 0
            ? prisma.topic.findMany({
                where: { id: { in: topicIds } },
                select: {
                  id: true,
                  slug: true,
                  title: true,
                  user: { select: { username: true } },
                },
              })
            : Promise.resolve([]),
          replyIds.length > 0
            ? prisma.reply.findMany({
                where: { id: { in: replyIds } },
                select: {
                  id: true,
                  body: true,
                  user: { select: { username: true } },
                  topic: { select: { slug: true, title: true } },
                },
              })
            : Promise.resolve([]),
          commentIds.length > 0
            ? prisma.comment.findMany({
                where: { id: { in: commentIds } },
                select: {
                  id: true,
                  content: true,
                  user: { select: { username: true } },
                  card: { select: { slug: true, name: true } },
                  series: { select: { slug: true, title: true } },
                },
              })
            : Promise.resolve([]),
        ]);

        const listingCardSlugs = Array.from(new Set(listings.map((listing) => listing.cardSlug)));
        const cards =
          listingCardSlugs.length > 0
            ? await prisma.card.findMany({
                where: { slug: { in: listingCardSlugs } },
                select: { slug: true, name: true },
              })
            : [];

        const cardNameBySlug = new Map(cards.map((card) => [card.slug, card.name]));

        const listingMap = new Map(
          listings.map((listing) => [
            listing.id,
            {
              cardSlug: listing.cardSlug,
              cardName: cardNameBySlug.get(listing.cardSlug),
              status: listing.status,
              sellerUsername: listing.user?.username ?? null,
            },
          ]),
        );
        const topicMap = new Map(
          topics.map((topic) => [
            topic.id,
            {
              slug: topic.slug,
              title: topic.title,
              authorUsername: topic.user?.username ?? null,
            },
          ]),
        );
        const replyMap = new Map(
          replies.map((reply) => [
            reply.id,
            {
              topicSlug: reply.topic.slug,
              topicTitle: reply.topic.title,
              authorUsername: reply.user?.username ?? null,
              excerpt: reply.body.slice(0, 160),
            },
          ]),
        );
        const commentMap = new Map(
          comments.map((comment) => [
            comment.id,
            {
              cardSlug: comment.card?.slug ?? null,
              cardName: comment.card?.name ?? null,
              seriesSlug: comment.series?.slug ?? null,
              seriesTitle: comment.series?.title ?? null,
              authorUsername: comment.user?.username ?? null,
              excerpt: comment.content.slice(0, 160),
            },
          ]),
        );

        return {
          items: sliced.map((r: ReportWithReporter) => ({
            id: r.id,
            targetType: r.targetType,
            targetId: r.targetId,
            reason: r.reason,
            status: r.status,
            createdAt: r.createdAt.toISOString(),
            resolvedAt: r.resolvedAt?.toISOString() ?? null,
            resolver: r.resolver,
            resolution: r.resolution,
            reporter: r.reporter,
            target:
              r.targetType === 'LISTING'
                ? (listingMap.get(r.targetId) ?? null)
                : r.targetType === 'TOPIC'
                  ? (topicMap.get(r.targetId) ?? null)
                  : r.targetType === 'REPLY'
                    ? (replyMap.get(r.targetId) ?? null)
                    : (commentMap.get(r.targetId) ?? null),
          })),
          nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
        };
      }),

      resolve: t.authedProcedure.input(reportResolveInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const requester = await getAdminRequester(prisma, ctx.user.sub);
        assertAdmin(requester, '仅管理员可处理举报');

        const resolution = input.resolution?.trim() || null;
        const actor = ctx.user;

        await prisma.$transaction(async (tx) => {
          const report = await tx.report.findUnique({
            where: { id: input.id },
            select: {
              id: true,
              status: true,
              targetType: true,
              targetId: true,
            },
          });
          if (!report) {
            throw new TRPCError({ code: 'NOT_FOUND', message: '举报记录不存在' });
          }

          if (report.status === 'RESOLVED') {
            return;
          }

          const author = await reportedAuthor(tx, report.targetType, report.targetId);

          if (input.action === 'MARK_RESOLVED') {
            await tx.report.update({
              where: { id: input.id },
              data: {
                status: 'RESOLVED',
                resolvedAt: new Date(),
                resolvedById: requester!.id,
                resolution,
              },
            });
          } else {
            if (!author.found) {
              throw new TRPCError({ code: 'NOT_FOUND', message: '举报目标不存在或已被删除' });
            }
            await removeReportedTarget(tx, report.targetType, report.targetId);
            await tx.report.updateMany({
              where: {
                targetType: report.targetType,
                targetId: report.targetId,
                status: 'PENDING',
              },
              data: {
                status: 'RESOLVED',
                resolvedAt: new Date(),
                resolvedById: requester!.id,
                resolution,
              },
            });
          }

          await writeReportResolve(tx, {
            actorId: actor.sub,
            actorUsername: actor.username,
            targetId: report.id,
            targetLabel: report.targetType,
            targetUserId: author.userId,
            reason: resolution,
          });
        });

        return { ok: true };
      }),
    });
  }
}
