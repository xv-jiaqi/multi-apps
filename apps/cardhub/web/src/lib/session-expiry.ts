import { APP_ERROR_CODES } from '@repo/shared';
import { rootStore } from '../stores/root-store';

type Listener = () => void;

const listeners = new Set<Listener>();

const PUBLIC_AUTH_PATHS = new Set(['auth.login', 'auth.register']);

export function subscribeSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  listeners.forEach((listener) => listener());
}

function readData(error: unknown): { code?: string; appCode?: string; path?: string } | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined;
  const data = error.data;
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as { code?: unknown; appCode?: unknown; path?: unknown };
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    appCode: typeof record.appCode === 'string' ? record.appCode : undefined,
    path: typeof record.path === 'string' ? record.path : undefined,
  };
}

/**
 * A bearer token that the server no longer accepts. Wrong-password and the
 * anonymous login/register forms are not expired sessions.
 */
export function noteTrpcFailure(error: unknown): void {
  const data = readData(error);
  if (!data || data.code !== 'UNAUTHORIZED') return;
  if (data.appCode === APP_ERROR_CODES.WRONG_PASSWORD) return;
  if (data.path && PUBLIC_AUTH_PATHS.has(data.path)) return;
  if (!rootStore.session.token) return;
  emitSessionExpired();
}
