/// <reference lib="dom" />
// page.evaluate callbacks run in the browser.
/**
 * CH-227 27-1/27-2: a stored token the server rejects, cold-loaded on a
 * non-forum public page. auth.me and the header's notifications.unreadCount
 * both come back 401. Whichever lands first, the reader stays on the page,
 * signed out, with no notice. Each case holds the two requests back by
 * different amounts so the order is forced, and checks the recorded order
 * (the netlog annotation) before checking the page.
 */
import { expect, test, type Page } from '@playwright/test';

const ME = 'auth.me';
const UNREAD = 'notifications.unreadCount';
/** Long enough for the page's own batch (which carries the unread count) to go out. */
const FIRST_DELAY_MS = 400;
const SECOND_DELAY_MS = 1_200;

/** One /trpc request that carried auth.me or the unread count, in the order it settled. */
type Arrival = {
  procedures: string[];
  /** tRPC error status per procedure in this batch, or 'aborted' if the page cancelled it. */
  outcome: Record<string, number | 'ok' | 'aborted'>;
};

function proceduresOf(url: string): string[] {
  const { pathname } = new URL(url);
  const joined = /\/trpc\/(.+)$/.exec(pathname)?.[1];
  return joined ? decodeURIComponent(joined).split(',') : [];
}

function readField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  return Reflect.get(value, key);
}

function slotOutcome(slot: unknown): number | 'ok' {
  const status = readField(readField(readField(slot, 'error'), 'data'), 'httpStatus');
  return typeof status === 'number' ? status : 'ok';
}

function watched(procedures: string[]): boolean {
  return procedures.includes(ME) || procedures.includes(UNREAD);
}

async function seedRejectedSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'cardhub:session',
      JSON.stringify({
        token: 'not-a-valid-token',
        user: { id: 'not-real', username: 'alice', role: 'user' },
      }),
    );
  });
}

/**
 * Records, in settle order, what each request carrying auth.me or the unread
 * count returned. A held request the page cancels after sign-out is recorded
 * as aborted: the app would drop it anyway (session-expiry.ts, no token).
 */
function recordArrivals(page: Page): Arrival[] {
  const arrivals: Arrival[] = [];
  page.on('response', async (response) => {
    const procedures = proceduresOf(response.url());
    if (!watched(procedures)) return;
    const body: unknown = await response.json().catch(() => null);
    const slots = Array.isArray(body) ? body : [body];
    const outcome: Arrival['outcome'] = {};
    procedures.forEach((procedure, index) => {
      outcome[procedure] = slotOutcome(slots[index]);
    });
    arrivals.push({ procedures, outcome });
  });
  page.on('requestfailed', (request) => {
    const procedures = proceduresOf(request.url());
    if (!watched(procedures)) return;
    const outcome: Arrival['outcome'] = {};
    for (const procedure of procedures) outcome[procedure] = 'aborted';
    arrivals.push({ procedures, outcome });
  });
  return arrivals;
}

/** Records every main-frame pathname, so a passing visit to /login is caught too. */
function recordVisits(page: Page): string[] {
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });
  return visited;
}

/**
 * Holds requests carrying `first` by FIRST_DELAY_MS and those carrying
 * `second` by SECOND_DELAY_MS, so both are in flight together and settle in
 * that order.
 */
async function forceOrder(page: Page, { first, second }: { first: string; second: string }) {
  await page.route(/\/trpc\//, async (route) => {
    const procedures = proceduresOf(route.request().url());
    const holdMs = procedures.includes(second)
      ? SECOND_DELAY_MS
      : procedures.includes(first)
        ? FIRST_DELAY_MS
        : 0;
    if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
    await route.continue().catch(() => undefined);
  });
}

function firstIndex(arrivals: Arrival[], procedure: string): number {
  return arrivals.findIndex((arrival) => arrival.procedures.includes(procedure));
}

async function expectSignedOutInPlace(page: Page, path: string, visited: string[]) {
  expect(new URL(page.url()).pathname).toBe(path);
  expect(visited).not.toContain('/login');
  const stored = await page.evaluate(() => localStorage.getItem('cardhub:session'));
  expect(stored ?? '').not.toContain('not-a-valid-token');
  await expect(
    page.getByRole('banner').getByRole('link', { name: '登录', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('登录已失效')).toHaveCount(0);
}

/**
 * '/' is not in this list: it renders without a lazy chunk, so auth.me and the
 * unread count share one batch and cannot be ordered by holding requests. The
 * last test covers it, and the 27-2 unit tests cover both orders there.
 */
const PAGES = ['/series', '/trade', '/calendar', '/categories', '/search'];
const ORDERS: ReadonlyArray<{ name: string; first: string; second: string }> = [
  { name: 'unreadCount first', first: UNREAD, second: ME },
  { name: 'auth.me first', first: ME, second: UNREAD },
];

test.use({ viewport: { width: 1440, height: 900 } });

for (const path of PAGES) {
  for (const order of ORDERS) {
    test(`27-1 ${path}: bad token, ${order.name} → stays, signed out, no notice`, async ({
      page,
    }) => {
      await seedRejectedSession(page);
      await forceOrder(page, order);
      const arrivals = recordArrivals(page);
      const visited = recordVisits(page);

      await page.goto(path);
      await expect
        .poll(() => firstIndex(arrivals, order.second), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(0);
      // Give a late navigation the chance to happen before asserting it did not.
      await page.waitForTimeout(FIRST_DELAY_MS);

      test.info().annotations.push({ type: 'netlog', description: JSON.stringify(arrivals) });
      const first = firstIndex(arrivals, order.first);
      const second = firstIndex(arrivals, order.second);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(second);
      expect(arrivals[first]?.procedures).not.toContain(order.second);
      expect(arrivals[first]?.outcome[order.first]).toBe(401);
      expect([401, 'aborted']).toContain(arrivals[second]?.outcome[order.second]);
      await expectSignedOutInPlace(page, path, visited);
    });
  }
}

test('27-1 /: bad token, auth.me and the unread count rejected in one batch → stays', async ({
  page,
}) => {
  await seedRejectedSession(page);
  const arrivals = recordArrivals(page);
  const visited = recordVisits(page);

  await page.goto('/');
  await expect
    .poll(() => Math.max(firstIndex(arrivals, ME), firstIndex(arrivals, UNREAD)), {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(FIRST_DELAY_MS);

  test.info().annotations.push({ type: 'netlog', description: JSON.stringify(arrivals) });
  expect(arrivals[firstIndex(arrivals, ME)]?.outcome[ME]).toBe(401);
  expect(arrivals[firstIndex(arrivals, UNREAD)]?.outcome[UNREAD]).toBe(401);
  await expectSignedOutInPlace(page, '/', visited);
});
