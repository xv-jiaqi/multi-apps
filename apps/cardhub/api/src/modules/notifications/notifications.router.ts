import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { APP_ERROR_CODES, notificationListInput, notificationMarkReadInput } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { decodeNotificationCursor, encodeNotificationCursor } from './cursor';
import { hrefFor, liveHrefMap, parentIdFor } from './href';

function unauthenticated(): TRPCError {
  return new TRPCError({
    code: 'UNAUTHORIZED',
    cause: { appCode: APP_ERROR_CODES.UNAUTHORIZED },
  });
}

function notificationDenied(): TRPCError {
  return new TRPCError({
    code: 'FORBIDDEN',
    message: '没有权限',
    cause: { appCode: APP_ERROR_CODES.FORBIDDEN },
  });
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function olderThan(point: { createdAt: Date; id: string }) {
  return {
    OR: [
      { createdAt: { lt: point.createdAt } },
      { AND: [{ createdAt: point.createdAt }, { id: { lt: point.id } }] },
    ],
  };
}

@Injectable()
export class NotificationsRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      list: t.authedProcedure.input(notificationListInput).query(async ({ ctx, input }) => {
        if (!ctx.user) throw unauthenticated();
        const userId = ctx.user.sub;
        const point = input.cursor ? decodeNotificationCursor(input.cursor) : null;
        if (input.cursor && !point) return { items: [], nextCursor: null };

        const rows = await prisma.notification.findMany({
          where: { userId, ...(point ? olderThan(point) : {}) },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          include: { actor: { select: { username: true } } },
        });
        const hasMore = rows.length > input.limit;
        const page = hasMore ? rows.slice(0, input.limit) : rows;
        const hrefs = await liveHrefMap(prisma, page);
        const last = page.at(-1);
        const nextCursor =
          hasMore && last ? encodeNotificationCursor(last.createdAt, last.id) : null;
        if (hasMore && !nextCursor) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '通知游标无效' });
        }

        return {
          items: page.map((row) => {
            const action =
              row.action === 'MARK_RESOLVED' || row.action === 'REMOVE_TARGET'
                ? { action: row.action }
                : {};
            const parentId = parentIdFor(hrefs, row);
            return {
              id: row.id,
              type: row.type,
              actor: row.actor ? { username: row.actor.username } : null,
              excerpt: row.excerpt,
              href: hrefFor(hrefs, row),
              ...(parentId ? { parentId } : {}),
              readAt: isoOrNull(row.readAt),
              createdAt: row.createdAt.toISOString(),
              ...action,
            };
          }),
          nextCursor,
        };
      }),

      // Polled about once a minute. The filter matches notifications_userId_readAt_idx.
      unreadCount: t.authedProcedure.query(async ({ ctx }) => {
        if (!ctx.user) throw unauthenticated();
        const count = await prisma.notification.count({
          where: { userId: ctx.user.sub, readAt: null },
        });
        return { count };
      }),

      markRead: t.authedProcedure
        .input(notificationMarkReadInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw unauthenticated();
          const userId = ctx.user.sub;
          const updated = await prisma.notification.updateMany({
            where: { id: input.id, userId, readAt: null },
            data: { readAt: new Date() },
          });
          if (updated.count > 0) return { ok: true };
          const owned = await prisma.notification.findFirst({
            where: { id: input.id, userId },
            select: { id: true },
          });
          if (!owned) throw notificationDenied();
          return { ok: true };
        }),

      markAllRead: t.authedProcedure.mutation(async ({ ctx }) => {
        if (!ctx.user) throw unauthenticated();
        await prisma.notification.updateMany({
          where: { userId: ctx.user.sub, readAt: null },
          data: { readAt: new Date() },
        });
        return { count: 0 };
      }),
    });
  }
}
