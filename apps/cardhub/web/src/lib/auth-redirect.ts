import type { Location } from 'react-router';

type RedirectState =
  | string
  | { from?: string | Pick<Location, 'pathname' | 'search' | 'hash'> }
  | null
  | undefined;

/** ASCII controls, including DEL. Browsers strip C0 controls, so "/\t/evil" becomes "//evil". */
function hasControlCharacter(path: string): boolean {
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Same-site path: exactly one leading slash, no backslash, no ASCII controls. */
function isSameSiteRelativePath(path: string): boolean {
  return (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('\\') &&
    !hasControlCharacter(path)
  );
}

/**
 * Check every decoded layer, then return the original string. Only a decode
 * failure on the raw input falls back. A later layer that cannot be decoded
 * (for example "100%" after "100%25") keeps the original value.
 */
function acceptPath(path: string, fallback: string): string {
  let current = path;
  for (let i = 0; i < 5; i += 1) {
    if (!isSameSiteRelativePath(current)) return fallback;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return i === 0 ? fallback : path;
    }
    if (decoded === current) return path;
    current = decoded;
  }
  return fallback;
}

function pathnameOf(path: string): string {
  const hashAt = path.indexOf('#');
  const withoutHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  const pathname = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

/** `/login` and `/register` are not places to send someone after they sign in. */
function isAuthEntryPath(path: string): boolean {
  let current = path;
  for (let i = 0; i < 5; i += 1) {
    const pathname = pathnameOf(current);
    if (pathname === '/login' || pathname === '/register') return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return false;
    }
    if (decoded === current) return false;
    current = decoded;
  }
  return false;
}

function readPostAuthRedirect(state: RedirectState, fallback: string): string {
  if (typeof state === 'string') {
    return acceptPath(state, fallback);
  }

  if (!state || typeof state !== 'object') {
    return fallback;
  }

  const from = state.from;
  if (typeof from === 'string') {
    return acceptPath(from, fallback);
  }

  if (from && typeof from === 'object' && typeof from.pathname === 'string') {
    const target = `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
    return acceptPath(target, fallback);
  }

  return fallback;
}

export function resolvePostAuthRedirect(state: RedirectState, fallback = '/'): string {
  const resolved = readPostAuthRedirect(state, fallback);
  if (!isAuthEntryPath(resolved)) return resolved;
  return isAuthEntryPath(fallback) ? '/' : fallback;
}
