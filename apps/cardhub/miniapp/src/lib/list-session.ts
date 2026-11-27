/** Remembers a list page across H5 remounts so returning from detail or compose keeps items and scroll. */
export type ListSessionKey = 'forum' | `trade:${string}`;

/** Signed-in user id, or null when signed out. Compared exactly; a different user must not reuse the snapshot. */
export type ListAuthKey = string | null;

export type ListSession<T, E = unknown> = {
  data: T;
  extra: E[];
  moreCursor: string | null;
  scrollTop: number;
  auth: ListAuthKey;
};

const store = new Map<string, ListSession<unknown, unknown>>();
const scrolls = new Map<string, number>();

export function listAuthKey(session: {
  isAuthenticated?: boolean;
  user?: { id: string } | null;
}): ListAuthKey {
  if (session.isAuthenticated === false) return null;
  return session.user?.id ?? null;
}

export function rememberListSession<T, E>(key: ListSessionKey, snapshot: ListSession<T, E>): void {
  const scrollTop = scrolls.has(key) ? (scrolls.get(key) as number) : snapshot.scrollTop;
  store.set(key, { ...(snapshot as ListSession<unknown, unknown>), scrollTop });
}

export function readListSession<T, E>(
  key: ListSessionKey,
  auth: ListAuthKey,
): ListSession<T, E> | null {
  const snapshot = store.get(key) as ListSession<T, E> | undefined;
  if (!snapshot || snapshot.auth !== auth) return null;
  return snapshot;
}

export function forgetListSession(key: ListSessionKey): void {
  store.delete(key);
  scrolls.delete(key);
}

export function forgetAllListSessions(): void {
  store.clear();
  scrolls.clear();
}

type SessionLike = {
  user: { id: string } | null;
  signOut: () => void;
  signIn: (token: string, user: { id: string; username: string; role?: string }) => void;
};

/** Clear every list snapshot on sign-out or when a different user signs in. */
export function bindListSessionsToSession(session: SessionLike): void {
  const originalOut = session.signOut.bind(session);
  session.signOut = () => {
    forgetAllListSessions();
    originalOut();
  };
  const originalIn = session.signIn.bind(session);
  session.signIn = (token, user) => {
    if (session.user?.id && session.user.id !== user.id) {
      forgetAllListSessions();
    }
    originalIn(token, user);
  };
}

export function writeListScroll(key: ListSessionKey, scrollTop: number): void {
  scrolls.set(key, scrollTop);
  const snapshot = store.get(key);
  if (snapshot) snapshot.scrollTop = scrollTop;
}

export function readListScroll(key: ListSessionKey): number {
  return scrolls.get(key) ?? store.get(key)?.scrollTop ?? 0;
}
