import { WechatApiSecCheckClient } from './wechat-sec-check.client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WechatApiSecCheckClient', () => {
  it('sends msgSecCheck v2 and returns suggest', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/cgi-bin/token')) {
        return jsonResponse({ access_token: 'tok', expires_in: 7200 });
      }
      return jsonResponse({ errcode: 0, result: { suggest: 'review', label: 200 } });
    };
    const client = new WechatApiSecCheckClient({
      appId: 'wx-app',
      appSecret: 'wx-secret',
      fetchImpl,
    });
    await expect(client.msgSecCheck({ openid: 'o1', scene: 3, content: 'hello' })).resolves.toBe(
      'review',
    );
    const check = calls.find((call) => call.url.includes('msg_sec_check'));
    expect(check?.url).toContain('access_token=tok');
    expect(JSON.parse(String(check?.init?.body))).toEqual({
      openid: 'o1',
      scene: 3,
      version: 2,
      content: 'hello',
    });
    expect(String(check?.url)).not.toContain('wx-secret');
    expect(String(check?.init?.body)).not.toContain('wx-secret');
  });

  it('returns a mediaCheckAsync trace id', async () => {
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes('/cgi-bin/token')) {
        return jsonResponse({ access_token: 'tok', expires_in: 7200 });
      }
      return jsonResponse({ errcode: 0, trace_id: 'tr-1' });
    };
    const client = new WechatApiSecCheckClient({
      appId: 'wx-app',
      appSecret: 'wx-secret',
      fetchImpl,
    });
    await expect(
      client.mediaCheckAsync({
        openid: 'o1',
        scene: 4,
        mediaUrl: 'https://cdn.example/a.png',
        mediaType: 2,
      }),
    ).resolves.toEqual({ traceId: 'tr-1' });
  });

  it('fails closed when WeChat returns an error code', async () => {
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes('/cgi-bin/token')) {
        return jsonResponse({ access_token: 'tok', expires_in: 7200 });
      }
      return jsonResponse({ errcode: 40001, errmsg: 'invalid credential' });
    };
    const client = new WechatApiSecCheckClient({
      appId: 'wx-app',
      appSecret: 'wx-secret',
      fetchImpl,
    });
    await expect(client.msgSecCheck({ openid: 'o1', scene: 2, content: 'x' })).rejects.toThrow(
      'WeChat msgSecCheck failed',
    );
  });

  it('exchanges a login code for openid and drops session_key', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse({
        openid: 'o-user-1',
        session_key: 'should-not-escape',
        unionid: 'u-1',
        errcode: 0,
      });
    };
    const client = new WechatApiSecCheckClient({
      appId: 'wx-app',
      appSecret: 'wx-secret',
      fetchImpl,
    });
    const result = await client.code2Session({ code: 'js-code-1' });
    expect(result).toEqual({ ok: true, openid: 'o-user-1' });
    expect(JSON.stringify(result)).not.toContain('should-not-escape');
    expect(JSON.stringify(result)).not.toContain('session_key');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('https://api.weixin.qq.com/sns/jscode2session');
    expect(calls[0]).toContain('appid=wx-app');
    expect(calls[0]).toContain('js_code=js-code-1');
    expect(calls[0]).toContain('grant_type=authorization_code');
  });

  it('returns a failed result when WeChat rejects the code, without leaking errmsg', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ errcode: 40163, errmsg: 'code been used, session_key leaked?' });
    const client = new WechatApiSecCheckClient({
      appId: 'wx-app',
      appSecret: 'wx-secret',
      fetchImpl,
    });
    const result = await client.code2Session({ code: 'used-code' });
    expect(result).toEqual({ ok: false, errcode: 40163 });
    expect(JSON.stringify(result)).not.toMatch(/session_key|leaked|errmsg/i);
  });

  it('returns a failed result when the HTTP call fails, without retrying', async () => {
    let hits = 0;
    const fetchImpl: typeof fetch = async () => {
      hits += 1;
      return jsonResponse({ errcode: -1, errmsg: 'system error' }, 500);
    };
    const client = new WechatApiSecCheckClient({
      appId: 'wx-app',
      appSecret: 'wx-secret',
      fetchImpl,
    });
    await expect(client.code2Session({ code: 'js-code-2' })).resolves.toEqual({
      ok: false,
      errcode: null,
    });
    expect(hits).toBe(1);
  });
});
