import Taro from '@tarojs/taro';
import { createTRPCClient, httpLink } from '@trpc/client';
import type { AppRouter } from '@repo/trpc-contract';
import { rootStore } from '../stores/root-store';

declare const TRPC_URL: string;

/**
 * Adapts the global `fetch` contract to Taro.request so tRPC links can run
 * inside all mini-program runtimes (WeChat / Alipay / TikTok / Baidu / QQ)
 * plus H5, where `Taro.request` falls through to `fetch` anyway.
 */
const taroFetch: typeof fetch = (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? 'GET').toUpperCase() as
    | 'GET'
    | 'POST'
    | 'PUT'
    | 'DELETE'
    | 'OPTIONS'
    | 'HEAD';

  let data: unknown;
  if (init?.body) {
    try {
      data = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    } catch {
      data = init.body;
    }
  }

  return new Promise((resolve, reject) => {
    Taro.request({
      url,
      method,
      data,
      header: (init?.headers as Record<string, string>) ?? { 'content-type': 'application/json' },
      success(res) {
        const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        const headers = new Headers(res.header as Record<string, string>);
        resolve(
          new Response(body, {
            status: res.statusCode,
            statusText: `HTTP ${res.statusCode}`,
            headers,
          }),
        );
      },
      fail(err) {
        reject(new Error(err.errMsg ?? 'Taro.request failed'));
      },
    });
  });
};

/**
 * tRPC client configured with:
 * - `TRPC_URL` injected at build time via `defineConstants` in
 *   `apps/cardhub/miniapp/config/index.ts`. Switches between localhost and
 *   the Render staging URL based on `process.env.TARO_APP_ENV`.
 * - A headers callback that reads the current session token from MobX on
 *   every request so sign-in / sign-out flows are picked up without
 *   recreating the client.
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: TRPC_URL,
      fetch: taroFetch,
      headers: () => {
        const token = rootStore.session.token;
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
