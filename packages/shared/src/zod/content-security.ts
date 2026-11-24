import { z } from 'zod';

/** WeChat `wx.login` js_code is short; keep a tight ceiling at the boundary. */
export const WECHAT_JS_CODE_MAX = 256;

/**
 * Client sends the one-time `wx.login` code. The server exchanges it for
 * openid; the client must not send or receive openid or session_key.
 */
export const recordMiniappVisitInput = z.object({
  code: z.string().trim().min(1, 'code_required').max(WECHAT_JS_CODE_MAX, 'code_too_long'),
});

export type RecordMiniappVisitInput = z.infer<typeof recordMiniappVisitInput>;

export const recordMiniappVisitResult = z.object({
  ok: z.literal(true),
});

export type RecordMiniappVisitResult = z.infer<typeof recordMiniappVisitResult>;
