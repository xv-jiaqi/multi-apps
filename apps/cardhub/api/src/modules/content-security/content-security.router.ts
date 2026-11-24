import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
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
    return t.router({
      recordMiniappVisit: t.authedProcedure
        .input(z.object({ openid: z.string().trim().min(4).max(128) }))
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          await this.contentSecurity.recordMiniappVisit({
            userId: ctx.user.sub,
            openid: input.openid,
          });
          return { ok: true };
        }),
    });
  }
}
