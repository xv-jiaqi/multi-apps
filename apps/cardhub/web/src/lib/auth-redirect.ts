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

/**
 * Decode percent-encoding before the path check. A value such as "/%09/…"
 * has no raw control character until it is decoded, and "%2509" needs a
 * second pass. A malformed sequence fails closed.
 */
function decodeRedirectTarget(value: string): string | null {
  let current = value;
  for (let i = 0; i < 5; i += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (decoded === current) return decoded;
    current = decoded;
  }
  return null;
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

function acceptPath(path: string, fallback: string): string {
  const decoded = decodeRedirectTarget(path);
  if (decoded === null || !isSameSiteRelativePath(decoded)) return fallback;
  return decoded;
}

export function resolvePostAuthRedirect(state: RedirectState, fallback = '/'): string {
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
