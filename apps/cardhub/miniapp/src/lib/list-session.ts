/** Remembers a list page across H5 remounts so returning from detail or compose keeps items and scroll. */
export type ListSessionKey = 'forum' | `trade:${string}`;

export type ListSession<T, E = unknown> = {
  data: T;
  extra: E[];
  moreCursor: string | null;
  scrollTop: number;
  auth: boolean;
};

const store = new Map<string, ListSession<unknown, unknown>>();
const scrolls = new Map<string, number>();

export function rememberListSession<T, E>(key: ListSessionKey, snapshot: ListSession<T, E>): void {
  const scrollTop = scrolls.has(key) ? (scrolls.get(key) as number) : snapshot.scrollTop;
  store.set(key, { ...(snapshot as ListSession<unknown, unknown>), scrollTop });
}

export function readListSession<T, E>(
  key: ListSessionKey,
  auth: boolean,
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

export function writeListScroll(key: ListSessionKey, scrollTop: number): void {
  scrolls.set(key, scrollTop);
  const snapshot = store.get(key);
  if (snapshot) snapshot.scrollTop = scrollTop;
}

export function readListScroll(key: ListSessionKey): number {
  return scrolls.get(key) ?? store.get(key)?.scrollTop ?? 0;
}
