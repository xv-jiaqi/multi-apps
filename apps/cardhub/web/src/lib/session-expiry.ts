import { APP_ERROR_CODES } from '@repo/shared';
import { rootStore } from '../stores/root-store';

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  listeners.forEach((listener) => listener());
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
  emitSessionExpired();
}
