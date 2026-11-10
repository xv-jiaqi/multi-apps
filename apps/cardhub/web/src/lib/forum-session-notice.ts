import { useSyncExternalStore } from 'react';
import { normalizeAppPathname } from './auth-redirect';

/**
 * CH-226 §6: "this session just ended" on the public forum. Memory only, so
 * a reload never shows it again. One flag for the whole app, so several
 * rejected requests in one expiry still show one notice.
 */
type NoticeState = { kind: 'hidden' } | { kind: 'shown'; pathname: string };

let state: NoticeState = { kind: 'hidden' };
const listeners = new Set<() => void>();

function setState(next: NoticeState): void {
  state = next;
  [...listeners].forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `/forum` and `/forum/:slug`. `/forum/new` and the edit page need login. */
export function isPublicForumPath(pathname: string): boolean {
  const path = normalizeAppPathname(pathname);
  if (path === '/forum') return true;
  const match = /^\/forum\/([^/]+)$/.exec(path);
  return match !== null && match[1] !== 'new';
}

export function showForumSessionNotice({ pathname }: { pathname: string }): void {
  if (!isPublicForumPath(pathname)) return;
  setState({ kind: 'shown', pathname: normalizeAppPathname(pathname) });
}

export function hideForumSessionNotice(): void {
  if (state.kind === 'hidden') return;
  setState({ kind: 'hidden' });
}

/** §6-7: leaving the page drops the notice; coming back does not bring it back. */
export function hideForumSessionNoticeOffPath({ pathname }: { pathname: string }): void {
  if (state.kind === 'shown' && state.pathname !== normalizeAppPathname(pathname)) {
    hideForumSessionNotice();
  }
}

function readState(): NoticeState {
  return state;
}

export function useForumSessionNoticeShown({ pathname }: { pathname: string }): boolean {
  const current = useSyncExternalStore(subscribe, readState, readState);
  return current.kind === 'shown' && current.pathname === normalizeAppPathname(pathname);
}

export function resetForumSessionNoticeForTests(): void {
  state = { kind: 'hidden' };
}
