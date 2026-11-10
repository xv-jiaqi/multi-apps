import { APP_ERROR_CODES } from '@repo/shared';
import { rootStore } from '../stores/root-store';

/**
 * Where the rejected request came from. A query is a background read the
 * page made on its own; anything else (a mutation, or a caller that does not
 * say) counts as a user action.
 */
export type SessionExpiryOrigin = 'query' | 'action';

type Listener = (error: unknown, origin: SessionExpiryOrigin) => void;

const listeners = new Set<Listener>();

export function subscribeSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSessionExpired(error?: unknown, origin: SessionExpiryOrigin = 'action'): void {
  // Copy first: a listener may unsubscribe while this runs.
  [...listeners].forEach((listener) => listener(error, origin));
}

/**
 * Session rejection is an appCode, not HTTP 401. Wrong-password is also 401
 * and must keep the current page.
 */
export function isSessionInvalidError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('data' in error)) return false;
  const data = error.data;
  if (typeof data !== 'object' || data === null || !('appCode' in data)) return false;
  return data.appCode === APP_ERROR_CODES.UNAUTHORIZED;
}

export function noteTrpcFailure(error: unknown): void {
  if (!isSessionInvalidError(error)) return;
  if (!rootStore.session.token) return;
  emitSessionExpired(error);
}

/** Query cache failures: background reads, not user actions. */
export function noteTrpcQueryFailure(error: unknown): void {
  if (!isSessionInvalidError(error)) return;
  if (!rootStore.session.token) return;
  emitSessionExpired(error, 'query');
}
