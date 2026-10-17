import { Injectable, Optional } from '@nestjs/common';
import { initTRPC, TRPCError } from '@trpc/server';
import type { TrpcContext } from './context';
import { PrismaService } from '../modules/prisma/prisma.service';

const t = initTRPC.context<TrpcContext>().create();

type TrpcRouterBuilder = typeof t.router;
type TrpcMergeRouters = typeof t.mergeRouters;
type TrpcMiddleware = typeof t.middleware;
type TrpcProcedure = typeof t.procedure;

/**
 * TrpcBase wraps a shared tRPC builder instance so that feature modules can
 * declare their own routers via NestJS DI while reusing the same `t` factory.
 */
@Injectable()
export class TrpcBase {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  readonly router: TrpcRouterBuilder = t.router;
  readonly mergeRouters: TrpcMergeRouters = t.mergeRouters;
  readonly middleware: TrpcMiddleware = t.middleware;
  readonly procedure: TrpcProcedure = t.procedure;

  readonly authedProcedure: TrpcProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  }) as unknown as TrpcProcedure;

  readonly adminProcedure: TrpcProcedure = t.procedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    if (!this.prisma) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Prisma 未初始化' });
    }
    const requester = await this.prisma.user.findUnique({
      where: { id: ctx.user.sub },
      select: { id: true, role: true },
    });
    if (requester?.role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: '仅管理员可管理内容' });
    }
    return next({ ctx: { ...ctx, user: ctx.user, adminUser: requester } });
  }) as unknown as TrpcProcedure;
}
