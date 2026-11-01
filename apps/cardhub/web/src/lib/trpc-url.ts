/**
 * Resolves the tRPC base URL across runtime targets:
 *
 * 1. Vite dev (browser) uses the relative `/trpc` path so the dev server
 *    proxy can forward to the API without CORS noise.
 * 2. Web container (browser) reads `/config.js`, generated at container start
 *    from runtime `TRPC_URL`.
 * 3. Tauri desktop WebView uses `VITE_TRPC_URL_TAURI`.
 * 4. Tauri Android emulator in dev uses `10.0.2.2`, the emulator loopback.
 * 5. Tauri iOS Simulator shares the host network and uses the Tauri URL.
 *
 * The Android dev check wins over the generic Tauri branch.
 * This module stays separate from the tRPC client so a test mock of that
 * client does not have to re-export the URL.
 */
function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function envUrl(value: unknown): string | undefined {
  return typeof value === 'string' ? nonEmpty(value) : undefined;
}

function assertAbsoluteTrpcUrl(value: string | undefined, target: string): string {
  if (value && /^https?:\/\/.+\/trpc$/.test(value)) {
    return value;
  }
  throw new Error(`${target} requires an absolute http(s) tRPC URL ending in /trpc.`);
}

function resolveTrpcUrl(): string {
  const runtimeUrl =
    typeof window !== 'undefined' ? nonEmpty(window.__CARDHUB_CONFIG__?.TRPC_URL) : undefined;
  const buildTimeUrl = envUrl(import.meta.env.VITE_TRPC_URL);
  const tauriUrl = envUrl(import.meta.env.VITE_TRPC_URL_TAURI);

  if (typeof window !== 'undefined') {
    const isTauri = '__TAURI_INTERNALS__' in window;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isAndroid = /Android/i.test(ua);

    if (isTauri && isAndroid && import.meta.env.DEV) {
      return 'http://10.0.2.2:4000/trpc';
    }
    if (isTauri) {
      return assertAbsoluteTrpcUrl(tauriUrl ?? buildTimeUrl, 'Tauri');
    }
  }

  return runtimeUrl ?? buildTimeUrl ?? '/trpc';
}

const TRPC_URL = resolveTrpcUrl();

export function cardhubTrpcUrl(): string {
  return TRPC_URL;
}
