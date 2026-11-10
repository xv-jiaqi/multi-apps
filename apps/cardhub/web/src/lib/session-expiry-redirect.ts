import { clearActiveQueryClient } from './trpc';
import { normalizeAppPathname, resolvePostAuthRedirect } from './auth-redirect';
import { isPublicForumPath, showForumSessionNotice } from './forum-session-notice';
import type { SessionExpiryOrigin } from './session-expiry';
import { rootStore } from '../stores/root-store';

/**
 * One sequence for a rejected stored session: clear it, then return to
 * /login with the current URL in state.from and the existing sessionExpired
 * notice. Login reads state.from (and drops a ?redirect query). Callers share
 * this function; a second call in the same turn does not navigate again.
 */
let returnedToLogin = false;

/**
 * True from the moment this sends someone to /login until a new pathname
 * commits. Pages that bounce anonymous visitors to /login (/forum/new, the
 * edit page) check it, so their plain bounce does not replace this
 * navigation and drop `notice: 'sessionExpired'` (CH-226 26-4).
 */
let expiryNavigationPending = false;

export function isSessionExpiryNavigationPending(): boolean {
  return expiryNavigationPending;
}

/** SessionExpiryWatcher calls this whenever the pathname changes. */
export function settleSessionExpiryNavigation(): void {
  expiryNavigationPending = false;
}

/** The redirect guard is process-wide. Unit tests reset it before each case. */
export function resetSessionExpiryRedirectForTests(): void {
  returnedToLogin = false;
  expiryNavigationPending = false;
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
  /** Omitted means a user action (useAppMutationError). */
  origin?: SessionExpiryOrigin;
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
 * auth.me is the session check AuthBootstrap runs as a query. A caller that
 * reports its rejection without saying where it came from still reports a
 * background read, never a user action.
 */
function failureOrigin(origin: SessionExpiryOrigin, error: unknown): SessionExpiryOrigin {
  if (origin === 'query') return 'query';
  return readProcedurePath(error) === 'auth.me' ? 'query' : 'action';
}

/**
 * Two questions decide it (CH-227 27-A), never which request arrived first:
 * does this route need a session, and was the rejected request a background
 * read or a user action? Protected pages and card pages (CH-203) always
 * return to login. On every other page a background read (auth.me, the
 * header's unread count) only signs out; a user action (comment, report,
 * collection write) returns to login.
 */
function sessionExpiryReturnsToLogin({
  pathname,
  error,
  origin,
}: {
  pathname: string;
  error: unknown;
  origin: SessionExpiryOrigin;
}): boolean {
  const path = normalizeAppPathname(pathname);
  if (pageRequiresLogin(path)) return true;
  if (/^\/cards\/[^/]+$/.test(path)) return true;
  return failureOrigin(origin, error) === 'action';
}

export function applySessionExpiry(input: ExpireNavigation): void {
  const hadToken = rootStore.session.token !== null;
  const returnsToLogin = sessionExpiryReturnsToLogin({
    pathname: input.pathname,
    error: input.error,
    origin: input.origin ?? 'action',
  });
  if (hadToken) {
    returnedToLogin = false;
    rootStore.session.signOut();
    if (!returnsToLogin && isPublicForumPath(input.pathname)) {
      // CH-226 §5/§6-1: stay on the forum page, keep what is on screen, and say why.
      clearActiveQueryClient({ scope: 'keepPublicForumReads' });
      showForumSessionNotice({ pathname: input.pathname });
    } else {
      clearActiveQueryClient();
    }
  }
  if (returnedToLogin) return;
  if (!returnsToLogin) return;
  if (!hadToken) clearActiveQueryClient();
  returnedToLogin = true;
  expiryNavigationPending = true;
  const from = resolvePostAuthRedirect(`${input.pathname}${input.search}${input.hash}`);
  input.navigate('/login', { replace: true, state: { from, notice: 'sessionExpired' } });
}
