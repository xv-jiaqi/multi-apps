/// <reference lib="dom" />
// page.evaluate callbacks run in the browser.
import { expect, test, type Page } from '@playwright/test';
import {
  apiCreateTopic,
  apiLogin,
  readPasswords,
  refetchAuthMeAfterIdle,
  revokeInDb,
  RESTORED,
  SESSION_EXPIRED,
  signInOnPage,
  signInViaStorage,
  statusesWithText,
  watchForSkeleton,
  resetRateLimits,
} from './forum-session-helpers';

async function aliceOnPage(page: Page) {
  const alice = await apiLogin({ identifier: 'alice', password: readPasswords().userPassword });
  await signInViaStorage({ page, session: alice, username: 'alice' });
  return alice;
}

async function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  await resetRateLimits();
});

let slug = '';
let title = '';

test.beforeAll(async () => {
  await resetRateLimits();
  const admin = await apiLogin({ identifier: 'admin', password: readPasswords().adminPassword });
  const topic = await apiCreateTopic({
    session: admin,
    title: (title = `CH-226 阅读 ${Date.now()}`),
    body: Array.from(
      { length: 30 },
      (_, i) => `第 ${i + 1} 段，读帖时登录失效不应把页面打回骨架。`,
    ).join('\n\n'),
  });
  slug = topic.slug;
});

test('26-1 + 26-2 /forum: stays, one status, no skeleton, scroll and focus kept; login returns to the same URL', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await aliceOnPage(page);
  await page.clock.install();
  await page.goto('/forum?view=all#top');
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 200));
  const before = await scrollY(page);
  const topicLink = page.getByRole('link', { name: title });
  await topicLink.focus();
  await watchForSkeleton(page);

  await revokeInDb('alice');
  await refetchAuthMeAfterIdle(page);

  await expect(statusesWithText(page, SESSION_EXPIRED)).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: SESSION_EXPIRED })).toHaveText(
    `${SESSION_EXPIRED} 登录`,
  );
  expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(
    '/forum?view=all#top',
  );
  expect(await page.evaluate(() => Reflect.get(window, '__ch226SkeletonSeen'))).toBe(false);
  expect(await scrollY(page)).toBe(before);
  await expect(topicLink).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('26-1-forum-list.png') });

  await statusesWithText(page, SESSION_EXPIRED).getByRole('link', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(statusesWithText(page, SESSION_EXPIRED)).toHaveCount(0);
  await signInOnPage({ page, identifier: 'alice', password: readPasswords().userPassword });
  await expect(page).toHaveURL(/\/forum\?view=all#top$/);
  await expect(statusesWithText(page, SESSION_EXPIRED)).toHaveCount(0);
});

test('26-1 + 26-2 /forum/:slug: stays, notice in the reply area, no skeleton, scroll kept; login returns with query and hash', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await aliceOnPage(page);
  await page.clock.install();
  await page.goto(`/forum/${slug}?ref=e2e#top`);
  await expect(page.locator('#reply-body')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 700));
  const before = await scrollY(page);
  await watchForSkeleton(page);

  await revokeInDb('alice');
  await refetchAuthMeAfterIdle(page);

  const notice = statusesWithText(page, SESSION_EXPIRED);
  await expect(notice).toHaveCount(1);
  await expect(page.locator('#reply-body')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '登录后即可回帖' })).toHaveCount(0);
  expect(page.url()).toMatch(new RegExp(`/forum/${slug}\\?ref=e2e#top$`));
  expect(await page.evaluate(() => Reflect.get(window, '__ch226SkeletonSeen'))).toBe(false);
  expect(await scrollY(page)).toBe(before);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await notice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('26-1-forum-detail.png') });

  await notice.getByRole('link', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(statusesWithText(page, SESSION_EXPIRED)).toHaveCount(0);
  await signInOnPage({ page, identifier: 'alice', password: readPasswords().userPassword });
  await expect(page).toHaveURL(new RegExp(`/forum/${slug}\\?ref=e2e#top$`));
  await expect(statusesWithText(page, SESSION_EXPIRED)).toHaveCount(0);
  await expect(page.locator('#reply-body')).toBeVisible();
});

test('26-3: focus in the reply box at a silent expiry lands on the notice, and the text is kept and restored', async ({
  page,
}) => {
  const alice = await aliceOnPage(page);
  await page.clock.install();
  await page.goto(`/forum/${slug}`);
  const box = page.locator('#reply-body');
  await box.click();
  await box.pressSequentially('切回页面时打到一半');

  await revokeInDb('alice');
  await refetchAuthMeAfterIdle(page);

  await expect(statusesWithText(page, SESSION_EXPIRED)).toHaveCount(1);
  const active = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    role: document.activeElement?.getAttribute('role'),
    text: document.activeElement?.textContent,
  }));
  expect(active.tag).toBe('P');
  expect(active.role).toBe('status');
  expect(active.text).toContain(SESSION_EXPIRED);
  const stored = await page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('cardhub:draft:forum:reply:'))
        return { key, value: sessionStorage.getItem(key) };
    }
    return null;
  });
  expect(stored?.value ? JSON.parse(stored.value) : null).toMatchObject({
    v: 1,
    userId: alice.userId,
    body: '切回页面时打到一半',
  });
  await page.keyboard.press('Tab');
  await expect(
    statusesWithText(page, SESSION_EXPIRED).getByRole('link', { name: '登录' }),
  ).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('26-3-focus-notice.png') });

  // 9-4: keyboard only from here.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('邮箱或用户名').fill('alice');
  await page.getByLabel('密码', { exact: true }).fill(readPasswords().userPassword);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/forum/${slug}$`));
  await expect(page.locator('#reply-body')).toHaveValue('切回页面时打到一半');
  await expect(page.locator('#reply-body')).toBeFocused();
  await expect(statusesWithText(page, RESTORED)).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('26-3-restored.png') });
});
