import { z } from 'zod';

/** WeChat `wx.login` js_code is short; keep a tight ceiling at the boundary. */
export const WECHAT_JS_CODE_MAX = 256;

/** CH-248 client-supplied openid bounds; kept so already-deployed clients still parse. */
export const WECHAT_OPENID_MIN = 4;
export const WECHAT_OPENID_MAX = 128;

/**
 * Add-only input: new clients send `code`. The optional `openid` field is
 * retained so already-deployed CH-248 clients do not get a 400, but the
 * server ignores it (never writes it, never uses it as identity).
 */
export const recordMiniappVisitInput = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'code_required')
    .max(WECHAT_JS_CODE_MAX, 'code_too_long')
    .optional(),
  /**
   * @deprecated CH-248 field. The server always ignores this value: it is
   * never written and is never used as identity. Openid comes only from
   * code2Session. Removing the field is a later shrink PR.
   */
  openid: z
    .string()
    .trim()
    .min(WECHAT_OPENID_MIN, 'openid_too_short')
    .max(WECHAT_OPENID_MAX, 'openid_too_long')
    .optional(),
});

export type RecordMiniappVisitInput = z.infer<typeof recordMiniappVisitInput>;

export const recordMiniappVisitResult = z.object({
  ok: z.literal(true),
});

export type RecordMiniappVisitResult = z.infer<typeof recordMiniappVisitResult>;
