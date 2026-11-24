/**
 * Guards "load more" against same-tick / rapid repeat clicks and against a
 * stale page being appended after the list has been reset (filter change or
 * returning to the tab). CH-301 §2 v1.4.
 */
export function createLoadMoreGuard() {
  let inFlight = false;
  let generation = 0;

  return {
    /** Invalidate in-flight work so its result is dropped and a new click may start. */
    invalidate() {
      generation += 1;
      inFlight = false;
    },
    /** Start a request. Returns a token, or null if one is already running. */
    tryStart(): number | null {
      if (inFlight) return null;
      inFlight = true;
      return generation;
    },
    isCurrent(token: number) {
      return token === generation;
    },
    finish(token: number) {
      if (token === generation) inFlight = false;
    },
  };
}
