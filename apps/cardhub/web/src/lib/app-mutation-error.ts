import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { t } from '@repo/shared';
import { clearActiveQueryClient } from './trpc';
import { isSessionInvalidError } from './session-expiry';
import { rootStore } from '../stores/root-store';

export type MutationErrorCopy = Partial<Record<string, string>>;

/**
 * One handler for user-initiated writes (comment, report, forum, trade).
 * A session-invalid appCode clears the session and returns to /login with
 * the current URL in state.from. NOT_FOUND and FORBIDDEN use retry-free
 * copy. Every other failure is localized copy. The raw tRPC code and the
 * server message are never shown.
 */
export function useAppMutationError() {
  const navigate = useNavigate();
  const location = useLocation();
  const locale = rootStore.locale.locale;

  return useCallback(
    (error: unknown, copy?: MutationErrorCopy): string | null => {
      if (isSessionInvalidError(error)) {
        const from = `${location.pathname}${location.search}${location.hash}`;
        rootStore.session.signOut();
        clearActiveQueryClient();
        navigate('/login', { replace: true, state: { from, notice: 'sessionExpired' } });
        return null;
      }
      const appCode = readMutationAppCode(error);
      if (appCode && copy?.[appCode]) return copy[appCode];
      const terminalKey = terminalCopyKey(appCode) ?? terminalCopyKey(readMutationCode(error));
      if (terminalKey) return t(locale, terminalKey);
      return t(locale, 'error.actionFailed');
    },
    [locale, location.hash, location.pathname, location.search, navigate],
  );
}

const TERMINAL_COPY_KEYS: Record<string, 'error.notFound' | 'error.forbidden'> = {
  NOT_FOUND: 'error.notFound',
  FORBIDDEN: 'error.forbidden',
};

function terminalCopyKey(
  code: string | undefined,
): 'error.notFound' | 'error.forbidden' | undefined {
  if (!code) return undefined;
  return TERMINAL_COPY_KEYS[code];
}

function readMutationData(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined;
  const data = error.data;
  if (typeof data !== 'object' || data === null) return undefined;
  return data as Record<string, unknown>;
}

function readMutationAppCode(error: unknown): string | undefined {
  const appCode = readMutationData(error)?.appCode;
  return typeof appCode === 'string' ? appCode : undefined;
}

function readMutationCode(error: unknown): string | undefined {
  const code = readMutationData(error)?.code;
  return typeof code === 'string' ? code : undefined;
}
