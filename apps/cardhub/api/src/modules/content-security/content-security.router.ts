import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { recordMiniappVisitInput, recordMiniappVisitResult } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { ContentSecurityService } from './content-security.service';

@Injectable()
export class ContentSecurityRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly contentSecurity: ContentSecurityService,
  ) {}

  build() {
    const t = this.t;
    // Banned users never reach WeChat, and every counted call can cost one
    // jscode2session request, so the quota sits before input parsing and the
    // service.
    const visitProcedure = t.activeUserProcedure.use(t.userRateLimit('miniappVisit'));
    return t.router({
      recordMiniappVisit: visitProcedure
        .input(recordMiniappVisitInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          // input.openid is @deprecated and is never forwarded or trusted.
          await this.contentSecurity.recordMiniappVisit({
            userId: ctx.user.sub,
            code: input.code,
          });
          return recordMiniappVisitResult.parse({ ok: true });
        }),
    });
  }
}
