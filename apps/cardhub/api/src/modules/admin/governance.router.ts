import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import {
  APP_ERROR_CODES,
  adminAuditListInput,
  adminUserBanInput,
  adminUsersListInput,
} from '@repo/shared';
import type { TrpcBase } from '../../trpc/trpc-base';
import type { PrismaService } from '../prisma/prisma.service';
import { USER_BAN_ACTION, USER_UNBAN_ACTION, contentSnapshot } from '../audit/content-delete';

const userRowInclude = {
  bannedBy: { select: { username: true } },
  _count: { select: { topics: true, replies: true, comments: true, listings: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof userRowInclude }>;

export interface GovernanceUserRow {
  id: string;
  username: string;
  email: string;
  role: string;
  createdAt: string;
  bannedAt: string | null;
  bannedBy: { username: string } | null;
  counts: { topics: number; replies: number; comments: number; listings: number };
}

function toUserRow(user: UserRow): GovernanceUserRow {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
    bannedBy: user.bannedBy ? { username: user.bannedBy.username } : null,
    counts: {
      topics: user._count.topics,
      replies: user._count.replies,
      comments: user._count.comments,
      listings: user._count.listings,
    },
  };
}

function userWhere(input: { q?: string; status?: 'active' | 'banned' }): Prisma.UserWhereInput {
  const q = input.q?.trim() ?? '';
  return {
    ...(q
      ? {
          OR: [
            { username: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(input.status === 'active' ? { bannedAt: null } : {}),
    ...(input.status === 'banned' ? { NOT: { bannedAt: null } } : {}),
  };
}

function governanceError(
  code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT',
  appCode: string,
  message: string,
  subject?: GovernanceUserRow,
): TRPCError {
  return new TRPCError({
    code,
    message,
    cause: subject ? { appCode, subject } : { appCode },
  });
}

export function buildAdminUsersRouter(t: TrpcBase, prisma: PrismaService) {
  return t.router({
    list: t.adminProcedure.input(adminUsersListInput).query(async ({ input }) => {
      const where = userWhere(input);
      const limit = input.limit;
      const [rows, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: userRowInclude,
        }),
        prisma.user.count({ where }),
      ]);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const items = page.map(toUserRow);
      return {
        items,
        total,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
      };
    }),

    ban: t.adminProcedure.input(adminUserBanInput).mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          cause: { appCode: APP_ERROR_CODES.UNAUTHORIZED },
        });
      }
      const actor = ctx.user;
      return prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: input.userId },
          include: userRowInclude,
        });
        if (!target) {
          throw governanceError('NOT_FOUND', APP_ERROR_CODES.NOT_FOUND, '用户不存在');
        }
        if (target.id === actor.sub) {
          throw governanceError('FORBIDDEN', APP_ERROR_CODES.CANNOT_BAN_SELF, '不能封禁自己');
        }
        if (target.role === 'admin') {
          throw governanceError('FORBIDDEN', APP_ERROR_CODES.CANNOT_BAN_ADMIN, '不能封禁管理员');
        }
        if (target.bannedAt) {
          throw governanceError(
            'CONFLICT',
            APP_ERROR_CODES.ALREADY_BANNED,
            '该用户已被封禁',
            toUserRow(target),
          );
        }
        const bannedAt = new Date();
        const marked = await tx.user.updateMany({
          where: { id: target.id, bannedAt: null },
          data: {
            bannedAt,
            bannedById: actor.sub,
            tokenVersion: { increment: 1 },
          },
        });
        if (marked.count === 0) {
          const current = await tx.user.findUnique({
            where: { id: target.id },
            include: userRowInclude,
          });
          if (!current) {
            throw governanceError('NOT_FOUND', APP_ERROR_CODES.NOT_FOUND, '用户不存在');
          }
          throw governanceError(
            'CONFLICT',
            APP_ERROR_CODES.ALREADY_BANNED,
            '该用户已被封禁',
            toUserRow(current),
          );
        }
        const updated = await tx.user.findUnique({
          where: { id: target.id },
          include: userRowInclude,
        });
        if (!updated) {
          throw governanceError('NOT_FOUND', APP_ERROR_CODES.NOT_FOUND, '用户不存在');
        }
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorUsername: actor.username,
            action: USER_BAN_ACTION,
            targetType: 'USER',
            targetId: target.id,
            targetLabel: contentSnapshot(target.username),
            targetUserId: target.id,
            reason: input.reason,
          },
        });
        return toUserRow(updated);
      });
    }),

    unban: t.adminProcedure.input(adminUserBanInput).mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          cause: { appCode: APP_ERROR_CODES.UNAUTHORIZED },
        });
      }
      const actor = ctx.user;
      return prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: input.userId },
          include: userRowInclude,
        });
        if (!target) {
          throw governanceError('NOT_FOUND', APP_ERROR_CODES.NOT_FOUND, '用户不存在');
        }
        if (!target.bannedAt) {
          throw governanceError(
            'CONFLICT',
            APP_ERROR_CODES.NOT_BANNED,
            '该用户未被封禁',
            toUserRow(target),
          );
        }
        const marked = await tx.user.updateMany({
          where: { id: target.id, bannedAt: { not: null } },
          data: { bannedAt: null, bannedById: null },
        });
        if (marked.count === 0) {
          const current = await tx.user.findUnique({
            where: { id: target.id },
            include: userRowInclude,
          });
          if (!current) {
            throw governanceError('NOT_FOUND', APP_ERROR_CODES.NOT_FOUND, '用户不存在');
          }
          throw governanceError(
            'CONFLICT',
            APP_ERROR_CODES.NOT_BANNED,
            '该用户未被封禁',
            toUserRow(current),
          );
        }
        const updated = await tx.user.findUnique({
          where: { id: target.id },
          include: userRowInclude,
        });
        if (!updated) {
          throw governanceError('NOT_FOUND', APP_ERROR_CODES.NOT_FOUND, '用户不存在');
        }
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorUsername: actor.username,
            action: USER_UNBAN_ACTION,
            targetType: 'USER',
            targetId: target.id,
            targetLabel: contentSnapshot(target.username),
            targetUserId: target.id,
            reason: input.reason,
          },
        });
        return toUserRow(updated);
      });
    }),
  });
}

export function buildAdminAuditRouter(t: TrpcBase, prisma: PrismaService) {
  return t.router({
    list: t.adminProcedure.input(adminAuditListInput).query(async ({ input }) => {
      let targetUserId: string | undefined;
      if (input.user) {
        const matched = await prisma.user.findUnique({
          where: { username: input.user },
          select: { id: true },
        });
        if (!matched) return { items: [], total: 0, nextCursor: null };
        targetUserId = matched.id;
      }
      const where: Prisma.AuditLogWhereInput = {
        ...(input.action ? { action: input.action } : {}),
        ...(targetUserId ? { targetUserId } : {}),
      };
      const limit = input.limit;
      const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: { targetUser: { select: { username: true } } },
        }),
        prisma.auditLog.count({ where }),
      ]);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return {
        items: page.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          action: row.action,
          actorId: row.actorId,
          actorUsername: row.actorUsername,
          targetType: row.targetType,
          targetId: row.targetId,
          targetLabel: row.targetLabel,
          targetUserId: row.targetUserId,
          targetUsername: row.targetUser?.username ?? null,
          reason: row.reason,
        })),
        total,
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
      };
    }),
  });
}
