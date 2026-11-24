import { Controller, Get, Req } from '@nestjs/common';
import type { MeResponse } from '@agent-hub/contract';
import type { Request } from 'express';
import { getPrincipal } from '../auth/principal';
import { Scopes } from './access';

@Controller()
export class MeController {
  @Scopes()
  @Get('me')
  me(@Req() req: Request): MeResponse {
    const principal = getPrincipal(req);
    return {
      kind: principal.kind,
      tokenId: principal.tokenId,
      scopes: [...principal.scopes],
      admin: principal.admin,
    };
  }
}
