import type { Location } from 'react-router';

type RedirectState =
  | string
  | { from?: string | Pick<Location, 'pathname' | 'search' | 'hash'> }
  | null
  | undefined;

/** Same-site path: one leading slash, not protocol-relative, and not a scheme. */
function isSameSiteRelativePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(path);
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
