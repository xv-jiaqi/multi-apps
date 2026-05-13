import type { Location } from 'react-router';

type RedirectState =
  | string
  | { from?: string | Pick<Location, 'pathname' | 'search' | 'hash'> }
  | null
  | undefined;

export function resolvePostAuthRedirect(state: RedirectState, fallback = '/'): string {
  if (typeof state === 'string' && state.length > 0) {
    return state;
  }

  if (!state || typeof state !== 'object') {
    return fallback;
  }

  const from = state?.from;
  if (typeof from === 'string' && from.length > 0) {
    return from;
  }

  if (from && typeof from === 'object' && typeof from.pathname === 'string') {
    return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
  }

  return fallback;
}
