import { Injectable } from '@nestjs/common';
import { initTRPC, TRPCError } from '@trpc/server';
import type { TrpcContext } from './context';

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
}
