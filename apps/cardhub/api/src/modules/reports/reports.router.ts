import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { reportCreateInput, reportListInput } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';

type ReportWithReporter = Prisma.ReportGetPayload<{
  include: { reporter: { select: { id: true; username: true } } };
}>;

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
      create: t.authedProcedure.input(reportCreateInput).mutation(async ({ ctx, input }) => {
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
          });
        }
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
        const requester = await prisma.user.findUnique({
          where: { id: ctx.user.sub },
          select: { role: true },
        });
        if (requester?.role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: '仅管理员可查看举报队列' });
        }
        const items = await prisma.report.findMany({
          where: { ...(input.status ? { status: input.status } : {}) },
          take: input.limit + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: { reporter: { select: { id: true, username: true } } },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;
        return {
          items: sliced.map((r: ReportWithReporter) => ({
            id: r.id,
            targetType: r.targetType,
            targetId: r.targetId,
            reason: r.reason,
            status: r.status,
            createdAt: r.createdAt.toISOString(),
            reporter: r.reporter,
          })),
          nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null,
        };
      }),
    });
  }
}
