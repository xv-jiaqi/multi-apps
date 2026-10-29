import { clearActiveQueryClient } from './trpc';
import { resolvePostAuthRedirect } from './auth-redirect';
import { rootStore } from '../stores/root-store';

/**
 * One sequence for a rejected stored session: clear it, then return to
 * /login with the current URL in state.from and the existing sessionExpired
 * notice. Login reads state.from (and drops a ?redirect query). Callers share
 * this function; a second call in the same turn does not navigate again.
 */
let returnedToLogin = false;

type ExpireNavigation = {
  pathname: string;
  search: string;
  hash: string;
  navigate: (
    to: string,
    options: { replace: true; state: { from: string; notice: 'sessionExpired' } },
  ) => void;
  error?: unknown;
};

function readProcedurePath(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined;
  const data = error.data;
  if (typeof data !== 'object' || data === null || !('path' in data)) return undefined;
  return typeof data.path === 'string' ? data.path : undefined;
}

function pageRequiresLogin(pathname: string): boolean {
  if (pathname === '/me' || pathname.startsWith('/me/')) return true;
  if (pathname === '/forum/new') return true;
  if (/^\/forum\/[^/]+\/edit$/.test(pathname)) return true;
  if (pathname === '/trade/new') return true;
  if (pathname === '/reports' || pathname.startsWith('/reports/')) return true;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return true;
  return false;
}

/**
 * Protected pages always return to login. A card page does too: it is public
 * to read, but opening it with a rejected token must not stop on the card.
 * auth.me on any other public page only signs out. Any other procedure is a
 * user action (comment, report, collection write) and returns to login.
 */
function sessionExpiryReturnsToLogin(pathname: string, error?: unknown): boolean {
  if (pageRequiresLogin(pathname)) return true;
  if (/^\/cards\/[^/]+$/.test(pathname)) return true;
  const path = readProcedurePath(error);
  if (!path || path === 'auth.me') return false;
  return true;
}

export function applySessionExpiry(input: ExpireNavigation): void {
  const hadToken = rootStore.session.token !== null;
  if (hadToken) {
    returnedToLogin = false;
    rootStore.session.signOut();
    clearActiveQueryClient();
  }
  if (returnedToLogin) return;
  if (!sessionExpiryReturnsToLogin(input.pathname, input.error)) return;
  if (!hadToken) clearActiveQueryClient();
  returnedToLogin = true;
  const from = resolvePostAuthRedirect(`${input.pathname}${input.search}${input.hash}`);
  input.navigate('/login', { replace: true, state: { from, notice: 'sessionExpired' } });
}
