import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '@repo/trpc-contract';
import { noteTrpcFailure } from './session-expiry';
import { cardhubTrpcUrl } from './trpc-url';
import { rootStore } from '../stores/root-store';

export const trpc = createTRPCReact<AppRouter>();

const TRPC_URL = cardhubTrpcUrl();

let activeQueryClient: QueryClient | null = null;

export function clearActiveQueryClient(): void {
  activeQueryClient?.clear();
}

export function TrpcProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      queryCache: new QueryCache({
        onError: (error) => noteTrpcFailure(error),
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
