import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MINIAPP_VISIT_ENSURE_FRESH_TIMEOUT_MS,
  MINIAPP_VISIT_FOREGROUND_SKIP_MS,
  MINIAPP_VISIT_RATE_LIMIT_BACKOFF_MS,
  MINIAPP_VISIT_STALE_MS,
  createMiniappVisitReporter,
  type MiniappVisitReporterDeps,
} from './create-miniapp-visit-reporter';

const srcDir = join(__dirname, '..');

function sourceFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === 'test-stubs') continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) continue;
      out.push({ path: full.slice(srcDir.length + 1), text: readFileSync(full, 'utf8') });
    }
  };
  walk(srcDir);
  return out;
}

function reporter(
  overrides: Partial<MiniappVisitReporterDeps> & { nowValue?: { current: number } },
) {
  const calls: { login: number; report: string[] } = { login: 0, report: [] };
  const nowValue = overrides.nowValue ?? { current: 1_000 };
  const deps: MiniappVisitReporterDeps = {
    isWeapp: () => true,
    isAuthenticated: () => true,
    userId: () => 'user-1',
    now: () => nowValue.current,
    login: async () => {
      calls.login += 1;
      return { code: `code-${calls.login}` };
    },
    report: async (input) => {
      calls.report.push(input.code);
      return { ok: true };
    },
    ...overrides,
  };
  return { reporter: createMiniappVisitReporter(deps), calls, nowValue };
}

describe('createMiniappVisitReporter', () => {
  it('sends a login code when a signed-in weapp user reports a visit', async () => {
    const { reporter: visit, calls } = reporter({});
    await visit.reportVisit();
    expect(calls.login).toBe(1);
    expect(calls.report).toEqual(['code-1']);
  });

  it('does nothing on H5 or when signed out', async () => {
    const signedOut = reporter({ isAuthenticated: () => false });
    await signedOut.reporter.reportVisit();
    await signedOut.reporter.ensureFresh();
    expect(signedOut.calls.login).toBe(0);

    const h5 = reporter({ isWeapp: () => false });
    await h5.reporter.reportVisit();
    await h5.reporter.ensureFresh();
    expect(h5.calls.login).toBe(0);
  });

  it('swallows a throwing platform check so writes can still run', async () => {
    const { reporter: visit, calls } = reporter({
      isWeapp: () => {
        throw new Error('Taro.getEnv is missing');
      },
    });
    await expect(visit.reportVisit()).resolves.toBeUndefined();
    await expect(visit.ensureFresh()).resolves.toBeUndefined();
    expect(calls.login).toBe(0);
  });

  it('swallows login and report errors, including an unconfigured server', async () => {
    const failedLogin = reporter({
      login: async () => {
        throw new Error('login failed');
      },
    });
    await expect(failedLogin.reporter.reportVisit()).resolves.toBeUndefined();
    expect(failedLogin.calls.report).toEqual([]);

    const failedReport = reporter({
      report: async () => {
        throw new Error('MINIAPP_NOT_CONFIGURED');
      },
    });
    await expect(failedReport.reporter.reportVisit()).resolves.toBeUndefined();
    await expect(failedReport.reporter.ensureFresh()).resolves.toBeUndefined();
  });

  it('does not send a second lifecycle report within two seconds', async () => {
    const nowValue = { current: 5_000 };
    const { reporter: visit, calls } = reporter({ nowValue });
    await visit.reportVisit();
    nowValue.current = 6_500;
    await visit.reportVisit();
    expect(calls.report).toEqual(['code-1']);
  });

  it('skips a launch or foreground report within 30 minutes of a successful one', async () => {
    const nowValue = { current: 5_000 };
    const { reporter: visit, calls } = reporter({ nowValue });
    await visit.reportVisit();
    expect(calls.report).toEqual(['code-1']);

    nowValue.current = 5_000 + 60_000;
    await visit.reportVisit();
    nowValue.current = 5_000 + MINIAPP_VISIT_FOREGROUND_SKIP_MS - 1;
    await visit.reportVisit();
    expect(calls.login).toBe(1);
    expect(calls.report).toEqual(['code-1']);

    nowValue.current = 5_000 + MINIAPP_VISIT_FOREGROUND_SKIP_MS + 3_000;
    await visit.reportVisit();
    expect(calls.report).toEqual(['code-1', 'code-2']);
  });

  it('keeps trying on foreground while the last report failed', async () => {
    const nowValue = { current: 5_000 };
    let fail = true;
    const { reporter: visit, calls } = reporter({
      nowValue,
      report: async (input) => {
        calls.report.push(input.code);
        if (fail) throw new Error('network');
        return { ok: true };
      },
    });
    await visit.reportVisit();
    nowValue.current = 8_000;
    await visit.reportVisit();
    expect(calls.report).toEqual(['code-1', 'code-2']);
    fail = false;
    nowValue.current = 11_000;
    await visit.reportVisit();
    nowValue.current = 14_000;
    await visit.reportVisit();
    expect(calls.report).toEqual(['code-1', 'code-2', 'code-3']);
  });

  it('reports on foreground again for a different user, and after reset', async () => {
    const nowValue = { current: 5_000 };
    let userId = 'alice';
    const { reporter: visit, calls } = reporter({ nowValue, userId: () => userId });
    await visit.reportVisit();
    userId = 'bob';
    nowValue.current = 8_000;
    await visit.reportVisit();
    expect(calls.report).toEqual(['code-1', 'code-2']);
    visit.reset();
    nowValue.current = 11_000;
    await visit.reportVisit();
    expect(calls.report).toEqual(['code-1', 'code-2', 'code-3']);
  });

  it('refreshes before a write only after 100 minutes, and again after a user switch', async () => {
    const nowValue = { current: 10_000 };
    let userId = 'alice';
    const { reporter: visit, calls } = reporter({
      nowValue,
      userId: () => userId,
    });
    await visit.ensureFresh();
    expect(calls.report).toEqual(['code-1']);
    nowValue.current = 10_000 + MINIAPP_VISIT_STALE_MS - 1;
    await visit.ensureFresh();
    expect(calls.report).toEqual(['code-1']);
    nowValue.current = 10_000 + MINIAPP_VISIT_STALE_MS;
    await visit.ensureFresh();
    expect(calls.report).toEqual(['code-1', 'code-2']);

    userId = 'bob';
    await visit.ensureFresh();
    expect(calls.report).toEqual(['code-1', 'code-2', 'code-3']);
  });

  it('reports again after reset, as when the user signs out', async () => {
    const nowValue = { current: 10_000 };
    const { reporter: visit, calls } = reporter({ nowValue });
    await visit.ensureFresh();
    visit.reset();
    await visit.ensureFresh();
    expect(calls.report).toEqual(['code-1', 'code-2']);
  });
});

describe('createMiniappVisitReporter server errors and slow reports', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const notConfigured = {
    data: { code: 'PRECONDITION_FAILED', appCode: 'MINIAPP_NOT_CONFIGURED' },
  };
  const tooMany = { data: { code: 'TOO_MANY_REQUESTS', appCode: 'TOO_MANY_REQUESTS' } };

  it('stops reporting for the session after a 412, until sign-out', async () => {
    const nowValue = { current: 5_000 };
    const { reporter: visit, calls } = reporter({
      nowValue,
      report: async (input) => {
        calls.report.push(input.code);
        throw notConfigured;
      },
    });
    await visit.reportVisit();
    nowValue.current += MINIAPP_VISIT_FOREGROUND_SKIP_MS;
    await visit.reportVisit();
    await visit.ensureFresh();
    expect(calls.login).toBe(1);
    expect(calls.report).toEqual(['code-1']);

    visit.reset();
    await visit.reportVisit();
    expect(calls.report).toEqual(['code-1', 'code-2']);
  });

  it('pauses for 10 minutes after a 429', async () => {
    const nowValue = { current: 5_000 };
    const { reporter: visit, calls } = reporter({
      nowValue,
      report: async (input) => {
        calls.report.push(input.code);
        throw tooMany;
      },
    });
    await visit.reportVisit();
    nowValue.current += MINIAPP_VISIT_RATE_LIMIT_BACKOFF_MS - 3_000;
    await visit.reportVisit();
    await visit.ensureFresh();
    expect(calls.login).toBe(1);

    nowValue.current += 3_000;
    await visit.reportVisit();
    expect(calls.report).toEqual(['code-1', 'code-2']);
  });

  it('does not keep a comment waiting more than 3 seconds for a slow report', async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { reporter: visit, calls } = reporter({
      login: async () => {
        calls.login += 1;
        await gate;
        return { code: 'late-code' };
      },
    });
    let settled = false;
    const pending = visit.ensureFresh().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(MINIAPP_VISIT_ENSURE_FRESH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
    expect(calls.report).toEqual([]);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.report).toEqual(['late-code']);
  });

  it('returns as soon as a fast report finishes, without waiting for the timeout', async () => {
    vi.useFakeTimers();
    const { reporter: visit, calls } = reporter({});
    await visit.ensureFresh();
    expect(calls.report).toEqual(['code-1']);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('miniapp client source', () => {
  it('does not mention openid or session_key', () => {
    const hits = sourceFiles()
      .filter(({ text }) => /openid|session_key/.test(text))
      .map(({ path }) => path);
    expect(hits).toEqual([]);
  });

  it('reports visits from launch, foreground, sign-in, and stale comment submits', () => {
    const app = readFileSync(join(srcDir, 'app.tsx'), 'utf8');
    expect(app).toContain('Taro.useLaunch');
    expect(app).toContain('miniappVisit.reportVisit');
    expect(app).toContain('miniappVisit.reset');
    const comments = readFileSync(join(srcDir, 'pages/cards/detail/index.tsx'), 'utf8');
    expect(comments).toContain('miniappVisit.ensureFresh');
    expect(comments.indexOf('miniappVisit.ensureFresh')).toBeLessThan(
      comments.indexOf('trpc.comments.create.mutate'),
    );
  });
});
