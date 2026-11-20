import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { readContentSecurityEnv } from '../../config/content-security-env';
import { ContentSecurityService } from './content-security.service';

const callbackBodySchema = z.object({
  trace_id: z.string().min(1).max(128),
  result: z.object({
    suggest: z.enum(['pass', 'review', 'risky']),
  }),
});

@SkipThrottle()
@Controller('internal/wechat')
export class ContentSecurityCallbackController {
  constructor(private readonly contentSecurity: ContentSecurityService) {}

  @Post('media-check')
  @HttpCode(200)
  async mediaCheck(
    @Body() body: unknown,
    @Headers('x-callback-token') headerToken: string | undefined,
  ) {
    const env = readContentSecurityEnv();
    if (!callbackAuthorized({ env, headerToken })) {
      throw new UnauthorizedException();
    }
    const parsed = callbackBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException();
    }
    try {
      await this.contentSecurity.handleMediaCallback({
        traceId: parsed.data.trace_id,
        suggest: parsed.data.result.suggest,
      });
    } catch (error) {
      if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
        throw new NotFoundException();
      }
      throw error;
    }
    return { ok: true };
  }
}

export function callbackAuthorized(args: {
  env: { callbackToken: string; credentialsConfigured: boolean };
  headerToken: string | undefined;
}): boolean {
  // An empty token must never authorize the HTTP callback, even when
  // WeChat credentials are absent. Tests and unconfigured environments
  // call the service directly instead of posting without a secret.
  if (!args.env.callbackToken) return false;
  return args.headerToken === args.env.callbackToken;
}
