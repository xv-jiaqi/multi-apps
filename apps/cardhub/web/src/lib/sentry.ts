import * as Sentry from '@sentry/react';

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** Read at call time so a runtime `/config.js` DSN is visible after boot. */
export function readSentryDsn(): string | undefined {
  const runtimeConfig = typeof window !== 'undefined' ? window.__CARDHUB_CONFIG__ : undefined;
  return (
    nonEmpty(runtimeConfig?.SENTRY_DSN) ??
    nonEmpty(import.meta.env.VITE_SENTRY_DSN as string | undefined)
  );
}

export function readSentryEnvironment(): string {
  const runtimeConfig = typeof window !== 'undefined' ? window.__CARDHUB_CONFIG__ : undefined;
  return (
    nonEmpty(runtimeConfig?.SENTRY_ENVIRONMENT) ?? (import.meta.env.MODE as string) ?? 'development'
  );
}

export function readSentryRelease(): string | undefined {
  const runtimeConfig = typeof window !== 'undefined' ? window.__CARDHUB_CONFIG__ : undefined;
  return nonEmpty(runtimeConfig?.GIT_SHA);
}

export function captureSentryException(
  error: unknown,
  extra?: Record<string, unknown>,
  tags?: Record<string, string>,
): void {
  if (!readSentryDsn()) return;
  if (extra || tags) {
    Sentry.captureException(error, {
      ...(extra ? { extra } : {}),
      ...(tags ? { tags } : {}),
    });
    return;
  }
  Sentry.captureException(error);
}
