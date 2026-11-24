/** Re-report before a write if the last successful visit is older than this. */
export const MINIAPP_VISIT_STALE_MS = 100 * 60 * 1000;

/** Collapse onLaunch + onShow both firing at cold start. */
const LIFECYCLE_DEDUPE_MS = 2_000;

export type MiniappVisitReporterDeps = {
  isWeapp: () => boolean;
  isAuthenticated: () => boolean;
  userId: () => string | null;
  now?: () => number;
  login: () => Promise<{ code: string }>;
  report: (input: { code: string }) => Promise<unknown>;
};

export type MiniappVisitReporter = {
  reportVisit: () => Promise<void>;
  ensureFresh: () => Promise<void>;
  reset: () => void;
};

/**
 * Reports a WeChat mini-program visit by sending a `wx.login` code to the
 * server. Failures are swallowed so login and browsing never break.
 */
export function createMiniappVisitReporter(deps: MiniappVisitReporterDeps): MiniappVisitReporter {
  const now = () => (deps.now ?? Date.now)();
  let lastSuccessAt: number | null = null;
  let lastSuccessUserId: string | null = null;
  let lastLifecycleAt = 0;
  let inFlight: Promise<void> | null = null;

  function rememberUser(): string | null {
    const userId = deps.userId();
    if (userId !== lastSuccessUserId) {
      lastSuccessAt = null;
      lastSuccessUserId = userId;
    }
    return userId;
  }

  async function reportOnce(): Promise<void> {
    if (!deps.isWeapp() || !deps.isAuthenticated()) return;
    const userId = rememberUser();
    if (!userId) return;
    if (inFlight) {
      await inFlight;
      return;
    }
    const run = (async () => {
      try {
        const { code } = await deps.login();
        if (typeof code !== 'string' || code.length === 0) return;
        await deps.report({ code });
        lastSuccessAt = now();
        lastSuccessUserId = userId;
      } catch {
        // Visit reporting must not block login, browsing, or the write itself.
      }
    })();
    inFlight = run;
    try {
      await run;
    } finally {
      if (inFlight === run) inFlight = null;
    }
  }

  return {
    async reportVisit() {
      try {
        if (!deps.isWeapp() || !deps.isAuthenticated()) return;
        const ts = now();
        if (lastLifecycleAt > 0 && ts - lastLifecycleAt < LIFECYCLE_DEDUPE_MS) return;
        lastLifecycleAt = ts;
        await reportOnce();
      } catch {
        // Visit reporting must not block launch, sign-in, or browsing.
      }
    },
    async ensureFresh() {
      try {
        if (!deps.isWeapp() || !deps.isAuthenticated()) return;
        const userId = rememberUser();
        if (!userId) return;
        if (lastSuccessAt !== null && now() - lastSuccessAt < MINIAPP_VISIT_STALE_MS) return;
        await reportOnce();
      } catch {
        // A failed or unavailable login must not block the write itself.
      }
    },
    reset() {
      lastSuccessAt = null;
      lastSuccessUserId = null;
      lastLifecycleAt = 0;
    },
  };
}
