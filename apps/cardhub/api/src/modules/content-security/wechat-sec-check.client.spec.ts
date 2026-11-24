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
});
