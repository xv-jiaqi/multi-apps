import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '@repo/trpc-contract';
import { rootStore } from '../stores/root-store';

export const trpc = createTRPCReact<AppRouter>();

const TRPC_URL = (import.meta.env.VITE_TRPC_URL as string | undefined) ?? '/trpc';

export function TrpcProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

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
