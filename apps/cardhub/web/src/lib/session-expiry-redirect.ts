import { clearActiveQueryClient } from './trpc';
import { normalizeAppPathname, resolvePostAuthRedirect } from './auth-redirect';
import { rootStore } from '../stores/root-store';

/**
 * One sequence for a rejected stored session: clear it, then return to
 * /login with the current URL in state.from and the existing sessionExpired
 * notice. Login reads state.from (and drops a ?redirect query). Callers share
 * this function; a second call in the same turn does not navigate again.
 */
let returnedToLogin = false;

/** The redirect guard is process-wide. Unit tests reset it before each case. */
export function resetSessionExpiryRedirectForTests(): void {
  returnedToLogin = false;
}

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
  const path = normalizeAppPathname(pathname);
  if (path === '/me' || path.startsWith('/me/')) return true;
  if (path === '/notifications') return true;
  if (path === '/forum/new') return true;
  if (/^\/forum\/[^/]+\/edit$/.test(path)) return true;
  if (path === '/trade/new') return true;
  if (path === '/reports' || path.startsWith('/reports/')) return true;
  if (path === '/admin' || path.startsWith('/admin/')) return true;
  return false;
}

/**
 * Protected pages always return to login. A card page does too: it is public
 * to read, but opening it with a rejected token must not stop on the card.
 * auth.me on any other public page only signs out. Any other procedure is a
 * user action (comment, report, collection write) and returns to login.
 */
function sessionExpiryReturnsToLogin(pathname: string, error?: unknown): boolean {
  const path = normalizeAppPathname(pathname);
  if (pageRequiresLogin(path)) return true;
  if (/^\/cards\/[^/]+$/.test(path)) return true;
  const procedure = readProcedurePath(error);
  if (!procedure || procedure === 'auth.me') return false;
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
