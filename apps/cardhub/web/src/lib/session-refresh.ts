type Refresh = () => void;

let refreshSession: Refresh | null = null;

/** AuthBootstrap registers the auth.me refetch. USER_BANNED calls it. */
export function bindSessionRefresh(refresh: Refresh): () => void {
  refreshSession = refresh;
  return () => {
    if (refreshSession === refresh) refreshSession = null;
  };
}

export function refreshSignedInSession(): void {
  refreshSession?.();
}
