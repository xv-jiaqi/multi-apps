import { createTRPCClient, httpLink } from '@trpc/client';
import type { AppRouter } from '@repo/trpc-contract';
import { CONTENT_SURFACE_HEADER, type ContentSurface } from '@repo/shared';

const MINIAPP_SURFACE: ContentSurface = 'miniapp';

/**
 * Headers for every miniapp tRPC request. `x-cardhub-surface: miniapp` makes
 * the api apply miniapp visibility (only checked content in public reads)
 * to every read, so a call that forgets `surface: 'miniapp'` can no longer
 * fall back to the web rules. An explicit `input.surface` still wins on the
 * server.
 */
export function miniappRequestHeaders(args: { token: string | null }): Record<string, string> {
  return {
    [CONTENT_SURFACE_HEADER]: MINIAPP_SURFACE,
    ...(args.token ? { authorization: `Bearer ${args.token}` } : {}),
  };
}

/**
 * The only place the miniapp builds a tRPC client (`trpc.ts` calls it with
 * Taro's fetch adapter; tests call it with a fake fetch).
 */
export function createMiniappTrpcClient(args: {
  url: string;
  fetch: typeof fetch;
  getToken: () => string | null;
}) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: args.url,
        fetch: args.fetch,
        headers: () => miniappRequestHeaders({ token: args.getToken() }),
      }),
    ],
  });
}
