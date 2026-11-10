/// <reference lib="dom" />
// page.evaluate callbacks run in the browser.
import { expect, test } from '@playwright/test';
import {
  apiCreateTopic,
  apiLogin,
  readDraftKeys,
  readPasswords,
  revokeInDb,
  RESTORED,
  signInOnPage,
  signInViaStorage,
  statusesWithText,
  resetRateLimits,
} from './forum-session-helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

test('26-5: A saves a reply draft, B signs in → not restored and gone; A signs in later → still nothing', async ({
  page,
}) => {
  const { userPassword, adminPassword } = readPasswords();
  const alice = await apiLogin({ identifier: 'alice', password: userPassword });
  const topic = await apiCreateTopic({
    session: alice,
    title: `CH-226 换账号 ${Date.now()}`,
    body: '正文',
  });
  await signInViaStorage({ page, session: alice, username: 'alice' });
  await page.goto(`/forum/${topic.slug}`);
  await page.locator('#reply-body').fill('A 的草稿');
  await revokeInDb('alice');
  await page.getByRole('button', { name: '发布回帖' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await readDraftKeys(page)).toEqual([`cardhub:draft:forum:reply:${topic.id}`]);

  await signInOnPage({ page, identifier: 'admin', password: adminPassword });
  await expect(page).toHaveURL(new RegExp(`/forum/${topic.slug}$`));
  await expect(page.locator('#reply-body')).toHaveValue('');
  await expect(statusesWithText(page, RESTORED)).toHaveCount(0);
  expect(await readDraftKeys(page)).toEqual([]);

  // Same tab: B leaves, A comes back to the same topic.
  await page.evaluate(() => localStorage.removeItem('cardhub:session'));
  await page.goto('/login');
  await signInOnPage({ page, identifier: 'alice', password: userPassword });
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/forum/${topic.slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('#reply-body')).toHaveValue('');
  await expect(statusesWithText(page, RESTORED)).toHaveCount(0);
});

test('26-8: anonymous 登录发帖 is ≥ 24px tall and lands on /forum/new after login', async ({
  page,
}) => {
  await page.goto('/forum');
  const cta = page.getByRole('link', { name: '登录后发布话题' });
  const box = await cta.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  const style = await cta.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { display: computed.display, minHeight: computed.minHeight };
  });
  // A flex item: inline-flex is blockified to flex; min-height is the 2.5.8 guarantee.
  expect(style.minHeight).toBe('24px');
  await cta.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login$/);
  await signInOnPage({ page, identifier: 'alice', password: readPasswords().userPassword });
  await expect(page).toHaveURL(/\/forum\/new$/);
  console.info(JSON.stringify({ ctaBox: box, style }));
});
