import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from '@tanstack/react-query';
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '@repo/trpc-contract';
import { bindNotificationQueryClient } from './notification-cache';
import { noteTrpcFailure, noteTrpcQueryFailure } from './session-expiry';
import { cardhubTrpcUrl } from './trpc-url';
import { rootStore } from '../stores/root-store';

export const trpc = createTRPCReact<AppRouter>();

const TRPC_URL = cardhubTrpcUrl();

let activeQueryClient: QueryClient | null = null;

/**
 * Public forum reads carry no viewer data (the API returns the same rows to
 * everyone), so they can stay on screen after a silent sign-out.
 */
const PUBLIC_FORUM_READS = new Set([
  'forum.topics.list',
  'forum.topics.bySlug',
  'forum.replies.list',
]);

function isPublicForumRead(queryKey: QueryKey): boolean {
  const path = queryKey[0];
  if (!Array.isArray(path) || !path.every((part) => typeof part === 'string')) return false;
  return PUBLIC_FORUM_READS.has(path.join('.'));
}

export type QueryClearScope = 'everything' | 'keepPublicForumReads';

/**
 * Drops cached data after a sign-out. `keepPublicForumReads` is CH-226 §5:
 * clearing the topic a reader is on remounts it as a skeleton and loses the
 * scroll position, so a silent sign-out on /forum or /forum/:slug keeps those
 * reads and removes everything else.
 */
export function clearActiveQueryClient({
  scope = 'everything',
}: { scope?: QueryClearScope } = {}): void {
  const client = activeQueryClient;
  if (!client) return;
  switch (scope) {
    case 'everything':
      client.clear();
      return;
    case 'keepPublicForumReads':
      client.getMutationCache().clear();
      client.removeQueries({ predicate: (query) => !isPublicForumRead(query.queryKey) });
      return;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

export function TrpcProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      queryCache: new QueryCache({
        onError: (error) => noteTrpcQueryFailure(error),
      }),
      mutationCache: new MutationCache({
        onError: (error) => noteTrpcFailure(error),
      }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          retry: 1,
        },
      },
    });
    activeQueryClient = client;
    bindNotificationQueryClient(client);
    return client;
  });

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: TRPC_URL,
          // Read token lazily on every request so MobX-driven sign-in /
          // sign-out flows pick up the new value without recreating the
          // tRPC client.
          headers: () => {
            const token = rootStore.session.token;
            return token ? { authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
