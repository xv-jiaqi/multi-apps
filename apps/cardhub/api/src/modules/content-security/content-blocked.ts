import { TRPCError } from '@trpc/server';
import { APP_ERROR_CODES } from '@repo/shared';

export function contentBlockedError(): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message: '内容未通过审核，请修改后再试',
    cause: { appCode: APP_ERROR_CODES.CONTENT_BLOCKED },
  });
}
