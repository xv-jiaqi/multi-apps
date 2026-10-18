import type { Location } from 'react-router';

type RedirectState =
  | string
  | { from?: string | Pick<Location, 'pathname' | 'search' | 'hash'> }
  | null
  | undefined;

/**
 * Browsers drop U+0000–U+001F, so `/\t/evil.example` becomes `//evil.example`.
 * Detect by code point. A control-character regex trips no-control-regex.
 */
function hasControlCharacter(path: string): boolean {
  for (const char of path) {
    if (char.charCodeAt(0) <= 0x1f) return true;
  }
  return false;
}

/** Same-site path: one leading slash, not protocol-relative (`//` or `/\`). */
function isSameSiteRelativePath(path: string): boolean {
  return (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/\\') &&
    !hasControlCharacter(path)
  );
}

export function resolvePostAuthRedirect(state: RedirectState, fallback = '/'): string {
  if (typeof state === 'string') {
    return isSameSiteRelativePath(state) ? state : fallback;
  }

  if (!state || typeof state !== 'object') {
    return fallback;
  }

  const from = state.from;
  if (typeof from === 'string') {
    return isSameSiteRelativePath(from) ? from : fallback;
  }

  if (from && typeof from === 'object' && typeof from.pathname === 'string') {
    const target = `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
    return isSameSiteRelativePath(target) ? target : fallback;
  }

  return fallback;
}
