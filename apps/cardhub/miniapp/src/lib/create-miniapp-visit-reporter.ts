import { readTrpcErrorCodes } from './load-error';

/** Re-report before a write if the last successful visit is older than this. */
export const MINIAPP_VISIT_STALE_MS = 100 * 60 * 1000;

/** Collapse onLaunch + onShow both firing at cold start. */
const LIFECYCLE_DEDUPE_MS = 2_000;

/** Launch / foreground / sign-in skip the report when one succeeded this recently. */
export const MINIAPP_VISIT_FOREGROUND_SKIP_MS = 30 * 60 * 1000;

/** A write waits at most this long for the report; the report keeps running without it. */
export const MINIAPP_VISIT_ENSURE_FRESH_TIMEOUT_MS = 3_000;

/** After a 429 from the server, stop reporting for this long. */
export const MINIAPP_VISIT_RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000;

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

/** Resolves when `work` settles or after `ms`, whichever is first. Never rejects. */
function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

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
  // Server says the mini program login is not configured (412): every further
  // report this session would fail the same way, so stop until sign-out.
  let unavailable = false;
  let backoffUntil = 0;

  function paused(): boolean {
    return unavailable || now() < backoffUntil;
  }

  function noteFailure(error: unknown): void {
    const { code, appCode } = readTrpcErrorCodes(error);
    if (code === 'PRECONDITION_FAILED' || appCode === 'MINIAPP_NOT_CONFIGURED') {
      unavailable = true;
    } else if (code === 'TOO_MANY_REQUESTS' || appCode === 'TOO_MANY_REQUESTS') {
      backoffUntil = now() + MINIAPP_VISIT_RATE_LIMIT_BACKOFF_MS;
    }
  }

  function rememberUser(): string | null {
    const userId = deps.userId();
    if (userId !== lastSuccessUserId) {
      lastSuccessAt = null;
      lastSuccessUserId = userId;
    }
    return userId;
  }

  async function reportOnce(): Promise<void> {
    if (!deps.isWeapp() || !deps.isAuthenticated() || paused()) return;
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
      } catch (error) {
        // Visit reporting must not block login, browsing, or the write itself.
        noteFailure(error);
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
        const userId = rememberUser();
        if (!userId) return;
        if (lastSuccessAt !== null && ts - lastSuccessAt < MINIAPP_VISIT_FOREGROUND_SKIP_MS) return;
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
        await withTimeout(reportOnce(), MINIAPP_VISIT_ENSURE_FRESH_TIMEOUT_MS);
      } catch {
        // A failed or unavailable login must not block the write itself.
      }
    },
    reset() {
      lastSuccessAt = null;
      lastSuccessUserId = null;
      lastLifecycleAt = 0;
      unavailable = false;
      backoffUntil = 0;
    },
  };
}
