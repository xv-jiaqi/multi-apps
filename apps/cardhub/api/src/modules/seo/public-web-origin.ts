import { z } from 'zod';

/** Same default as the Express CORS allowlist when `CORS_ORIGIN` is unset. */
export const DEFAULT_CORS_ORIGIN =
  'http://localhost:5173,http://localhost:10086,https://card-hub.app,https://staging.card-hub.app,tauri://localhost,https://tauri.localhost';

export const PUBLIC_WEB_ORIGIN_ERROR =
  'PUBLIC_WEB_ORIGIN must be an absolute http(s) origin without a path, query, or trailing slash';

const PUBLIC_WEB_ORIGIN_PATTERN =
  /^https?:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/i;

const originSchema = z.string().regex(PUBLIC_WEB_ORIGIN_PATTERN).refine(originPortAllowed, {
  message: PUBLIC_WEB_ORIGIN_ERROR,
});

function originPort(origin: string): number | undefined {
  const scheme = origin.indexOf('://');
  const colon = origin.lastIndexOf(':');
  if (scheme === -1 || colon <= scheme + 2) return undefined;
  const raw = origin.slice(colon + 1);
  if (!/^\d+$/.test(raw)) return undefined;
  const port = Number(raw);
  return Number.isInteger(port) ? port : undefined;
}

function originPortAllowed(origin: string): boolean {
  const port = originPort(origin);
  return port === undefined || (port >= 1 && port <= 65535);
}

export type PublicWebOriginSource = {
  nodeEnv?: string;
  publicWebOrigin?: string;
  corsOrigin?: string;
};

function splitOrigins(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isHttpsSite(origin: string): boolean {
  return origin.startsWith('https://') && !origin.startsWith('https://tauri.');
}

function isLocalHttp(origin: string): boolean {
  return origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
}

/**
 * Canonical web origin for sitemap `<loc>` values.
 * An explicit `PUBLIC_WEB_ORIGIN` wins. Otherwise production uses the first
 * https site in `CORS_ORIGIN` (skipping `https://tauri.*`), and other
 * environments prefer localhost so a dev allowlist that also lists production
 * does not publish production URLs.
 */
export function resolvePublicWebOrigin(source: PublicWebOriginSource): string {
  const explicit = source.publicWebOrigin?.trim() ?? '';
  if (explicit.length > 0) {
    const parsed = originSchema.safeParse(explicit);
    if (!parsed.success) throw new Error(PUBLIC_WEB_ORIGIN_ERROR);
    return parsed.data;
  }

  const configured = source.corsOrigin?.trim() ?? '';
  const origins = splitOrigins(configured.length > 0 ? configured : DEFAULT_CORS_ORIGIN);
  const nodeEnv = source.nodeEnv?.trim() ?? '';
  const httpsSite = origins.find(isHttpsSite);
  const local = origins.find(isLocalHttp);
  const chosen = nodeEnv === 'production' ? httpsSite : (local ?? httpsSite);
  const parsed = originSchema.safeParse(chosen ?? '');
  if (!parsed.success) {
    throw new Error(
      nodeEnv === 'production'
        ? 'Set PUBLIC_WEB_ORIGIN or an https CORS_ORIGIN so sitemap URLs have a web origin'
        : 'Set PUBLIC_WEB_ORIGIN or include an http://localhost origin in CORS_ORIGIN',
    );
  }
  return parsed.data;
}
