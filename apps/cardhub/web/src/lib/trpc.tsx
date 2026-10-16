import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '@repo/trpc-contract';
import { rootStore } from '../stores/root-store';

export const trpc = createTRPCReact<AppRouter>();

/**
 * Resolves the tRPC base URL across runtime targets:
 *
 * 1. **Vite dev (browser)** – uses the relative `/trpc` path so vite.config.ts
 *    proxy can forward to http://localhost:4000 without CORS noise.
 * 2. **Web container (browser)** – `/config.js` is generated at container
 *    start from runtime `TRPC_URL`; one image can serve staging and prod.
 * 3. **Tauri desktop WebView** – detected via `__TAURI_INTERNALS__` global.
 *    Uses `VITE_TRPC_URL_TAURI` so we can keep the desktop on the staging
 *    URL even when the same web bundle is served at a different origin.
 * 4. **Tauri Android emulator (M4)** – Android Emulator's loopback to host
 *    is `10.0.2.2`, not `localhost`. Detection runs only in DEV mode; release
 *    builds fall through to the staging URL.
 * 5. **Tauri iOS Simulator (M4)** – simulator shares the host's network so
 *    `localhost` works; falls into the regular Tauri branch.
 *
 * Order matters: the more specific check (Android dev) wins over the generic
 * Tauri branch.
 */
function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function resolveTrpcUrl(): string {
  const runtimeUrl =
    typeof window !== 'undefined' ? nonEmpty(window.__CARDHUB_CONFIG__?.TRPC_URL) : undefined;
  const buildTimeUrl = nonEmpty(import.meta.env.VITE_TRPC_URL as string | undefined);
  const tauriUrl = nonEmpty(import.meta.env.VITE_TRPC_URL_TAURI as string | undefined);

  if (typeof window !== 'undefined') {
    const isTauri = '__TAURI_INTERNALS__' in window;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isAndroid = /Android/i.test(ua);

    if (isTauri && isAndroid && import.meta.env.DEV) {
      return 'http://10.0.2.2:4000/trpc';
    }
    if (isTauri) {
      return tauriUrl ?? runtimeUrl ?? buildTimeUrl ?? '/trpc';
    }
  }

  return runtimeUrl ?? buildTimeUrl ?? '/trpc';
}

const TRPC_URL = resolveTrpcUrl();

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
