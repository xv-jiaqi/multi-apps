/// <reference lib="dom" />
// page.evaluate callbacks run in the browser.
import { expect, test } from '@playwright/test';
import {
  apiCreateTopic,
  apiLogin,
  apiReply,
  apiRevoke,
  onlyAuthMeRejects,
  readPasswords,
  refetchAuthMeAfterIdle,
  resetRateLimits,
  signInOnPage,
  watchForSkeleton,
} from './forum-session-helpers';

/**
 * CH-226 §5: on main, a silent expiry while reading /forum/:slug sent the page
 * back to its skeleton and scrollY from 900 to 0 (and the header's unread
 * count 401 even went to /login). Now the page, scroll and URL stay.
 */
test.beforeEach(async () => {
  await resetRateLimits();
});

for (const variant of ['whole batch rejects', 'only auth.me rejects'] as const) {
  test(`§5: silent expiry while reading a long topic keeps scroll, URL and content (${variant})`, async ({
    page,
  }) => {
    const { userPassword, adminPassword } = readPasswords();
    const author = await apiLogin({ identifier: 'admin', password: adminPassword });
    const topic = await apiCreateTopic({
      session: author,
      title: `CH-226 §5 ${variant} ${Date.now()}`,
      body: Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段正文。`).join('\n\n'),
    });
    for (let i = 0; i < 8; i += 1) {
      await apiReply({
        session: author,
        topicId: topic.id,
        body: `回帖 ${i + 1}\n\n${'x '.repeat(200)}`,
      });
    }
    if (variant === 'only auth.me rejects') await onlyAuthMeRejects(page);
    await page.clock.install();
    await page.goto('/login');
    await signInOnPage({ page, identifier: 'alice', password: userPassword });
    await page.waitForURL('**/');
    await page.goto(`/forum/${topic.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#reply-body')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 900));
    const before = await page.evaluate(() => window.scrollY);
    const url = page.url();
    await watchForSkeleton(page);

    await apiRevoke(await apiLogin({ identifier: 'alice', password: userPassword }));
    await refetchAuthMeAfterIdle(page);

    await expect(
      page.getByRole('status').filter({ hasText: '登录已失效，请重新登录。' }),
    ).toHaveCount(1);
    const after = await page.evaluate(() => window.scrollY);
    const flashed = await page.evaluate(() => Reflect.get(window, '__ch226SkeletonSeen') === true);
    console.info(JSON.stringify({ variant, before, after, flashed, url: page.url() }));
    expect(before).toBe(900);
    expect(after).toBe(before);
    expect(flashed).toBe(false);
    expect(page.url()).toBe(url);
    await page.screenshot({ path: test.info().outputPath('s5-after.png') });
  });
}
