import { z } from 'zod';

export const MSG_SEC_CHECK_SCENES = [1, 2, 3, 4] as const;
export type MsgSecCheckScene = (typeof MSG_SEC_CHECK_SCENES)[number];

export type WechatSuggest = 'pass' | 'review' | 'risky';

export interface WechatSecCheckClient {
  msgSecCheck(input: {
    openid: string;
    scene: MsgSecCheckScene;
    content: string;
  }): Promise<WechatSuggest>;
  mediaCheckAsync(input: {
    openid: string;
    scene: MsgSecCheckScene;
    mediaUrl: string;
    mediaType: 1 | 2;
  }): Promise<{ traceId: string }>;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
});

const suggestSchema = z.enum(['pass', 'review', 'risky']);

const msgSecCheckResponseSchema = z.object({
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
  result: z.object({ suggest: suggestSchema }).optional(),
});

const mediaCheckResponseSchema = z.object({
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
  trace_id: z.string().min(1).optional(),
});

const code2SessionResponseSchema = z.object({
  openid: z.string().min(1).optional(),
  session_key: z.string().optional(),
  unionid: z.string().optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
});

export type Code2SessionFailureReason = 'invalid' | 'timeout' | 'http';

export type Code2SessionResult =
  | { ok: true; openid: string }
  | { ok: false; errcode: number | null; reason: Code2SessionFailureReason };

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

export class WechatApiSecCheckClient implements WechatSecCheckClient {
  private token: TokenCache | null = null;

  constructor(
    private readonly options: {
      appId: string;
      appSecret: string;
      fetchImpl?: typeof fetch;
      now?: () => number;
    },
  ) {}

  async msgSecCheck(input: {
    openid: string;
    scene: MsgSecCheckScene;
    content: string;
  }): Promise<WechatSuggest> {
    const accessToken = await this.accessToken();
    const payload: unknown = await this.postJson(
      `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(accessToken)}`,
      {
        openid: input.openid,
        scene: input.scene,
        version: 2,
        content: input.content,
      },
    );
    const parsed = msgSecCheckResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error('WeChat msgSecCheck returned an unexpected payload');
    }
    if ((parsed.data.errcode ?? 0) !== 0 || !parsed.data.result) {
      throw new Error('WeChat msgSecCheck failed');
    }
    return parsed.data.result.suggest;
  }

  async mediaCheckAsync(input: {
    openid: string;
    scene: MsgSecCheckScene;
    mediaUrl: string;
    mediaType: 1 | 2;
  }): Promise<{ traceId: string }> {
    const accessToken = await this.accessToken();
    const payload: unknown = await this.postJson(
      `https://api.weixin.qq.com/wxa/media_check_async?access_token=${encodeURIComponent(accessToken)}`,
      {
        openid: input.openid,
        scene: input.scene,
        version: 2,
        media_url: input.mediaUrl,
        media_type: input.mediaType,
      },
    );
    const parsed = mediaCheckResponseSchema.safeParse(payload);
    if (!parsed.success || (parsed.data.errcode ?? 0) !== 0 || !parsed.data.trace_id) {
      throw new Error('WeChat mediaCheckAsync failed');
    }
    return { traceId: parsed.data.trace_id };
  }

  /**
   * Exchange a one-time `wx.login` code for openid. `session_key` is read
   * from the payload only to drop it; it is never returned or retained.
   * Callers must not retry the same code.
   */
  async code2Session(input: { code: string }): Promise<Code2SessionResult> {
    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(this.options.appId)}` +
      `&secret=${encodeURIComponent(this.options.appSecret)}` +
      `&js_code=${encodeURIComponent(input.code)}` +
      '&grant_type=authorization_code';
    let payload: unknown;
    try {
      payload = await this.getJson(url);
    } catch (error) {
      const timedOut =
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { ok: false, errcode: null, reason: timedOut ? 'timeout' : 'http' };
    }
    const parsed = code2SessionResponseSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, errcode: null, reason: 'invalid' };
    if ((parsed.data.errcode ?? 0) !== 0 || !parsed.data.openid) {
      return { ok: false, errcode: parsed.data.errcode ?? null, reason: 'invalid' };
    }
    return { ok: true, openid: parsed.data.openid };
  }

  private async accessToken(): Promise<string> {
    const now = (this.options.now ?? Date.now)();
    if (this.token && this.token.expiresAtMs > now) {
      return this.token.accessToken;
    }
    const url =
      'https://api.weixin.qq.com/cgi-bin/token' +
      `?grant_type=client_credential&appid=${encodeURIComponent(this.options.appId)}` +
      `&secret=${encodeURIComponent(this.options.appSecret)}`;
    const payload: unknown = await this.getJson(url);
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success || !parsed.data.access_token) {
      throw new Error('WeChat access token request failed');
    }
    const expiresInMs = Math.max((parsed.data.expires_in ?? 7200) - 300, 60) * 1000;
    this.token = { accessToken: parsed.data.access_token, expiresAtMs: now + expiresInMs };
    return parsed.data.access_token;
  }

  private get fetchFn(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetchFn(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('WeChat token HTTP request failed');
    return response.json();
  }

  private async postJson(url: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('WeChat security HTTP request failed');
    return response.json();
  }
}
