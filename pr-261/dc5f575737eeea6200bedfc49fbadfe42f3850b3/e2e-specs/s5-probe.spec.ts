import { expect, test } from '@playwright/test';
import {
  apiCreateTopic,
  apiLogin,
  apiReply,
  apiRevoke,
  readPasswords,
  refetchAuthMeAfterIdle,
  signInOnPage,
  watchForSkeleton,
  onlyAuthMeRejects,
} from './helpers';

test('§5 probe: silent expiry while reading a topic', async ({ page }) => {
  const { userPassword } = readPasswords();
  const author = await apiLogin({ identifier: 'admin', password: readPasswords().adminPassword });
  const topic = await apiCreateTopic({
    session: author,
    title: `§5 probe ${Date.now()}`,
    body: Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段正文。`).join('\n\n'),
  });
  for (let i = 0; i < 8; i += 1) {
    await apiReply({ session: author, topicId: topic.id, body: `回帖 ${i + 1}\n\n` + 'x '.repeat(200) });
  }
  if (test.info().title.includes('only auth.me')) await onlyAuthMeRejects(page);
  await page.clock.install();
  await page.goto('/login');
  await signInOnPage({ page, identifier: 'alice', password: userPassword });
  await page.waitForURL('**/');
  await page.goto(`/forum/${topic.slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByLabel('回复内容').or(page.locator('#reply-body'))).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 900));
  const before = await page.evaluate(() => window.scrollY);
  await watchForSkeleton(page);
  const alice = await apiLogin({ identifier: 'alice', password: userPassword });
  await apiRevoke(alice);
  await refetchAuthMeAfterIdle(page);
  await expect(page.getByRole('link', { name: '登录', exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.scrollY);
  const flashed = await page.evaluate(() => Reflect.get(window, '__ch226SkeletonSeen'));
  console.info(JSON.stringify({ before, after, flashed, url: page.url() }));
  await page.screenshot({ path: '/workspace/ch226-evidence/e2e/s5-fixed.png' });
});

test('§5 probe: only auth.me rejects while reading', async ({ page }) => {
  const { userPassword } = readPasswords();
  const author = await apiLogin({ identifier: 'admin', password: readPasswords().adminPassword });
  const topic = await apiCreateTopic({
    session: author,
    title: `§5 probe ${Date.now()}`,
    body: Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段正文。`).join('\n\n'),
  });
  for (let i = 0; i < 8; i += 1) {
    await apiReply({ session: author, topicId: topic.id, body: `回帖 ${i + 1}\n\n` + 'x '.repeat(200) });
  }
  if (test.info().title.includes('only auth.me')) await onlyAuthMeRejects(page);
  await page.clock.install();
  await page.goto('/login');
  await signInOnPage({ page, identifier: 'alice', password: userPassword });
  await page.waitForURL('**/');
  await page.goto(`/forum/${topic.slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByLabel('回复内容').or(page.locator('#reply-body'))).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 900));
  const before = await page.evaluate(() => window.scrollY);
  await watchForSkeleton(page);
  const alice = await apiLogin({ identifier: 'alice', password: userPassword });
  await apiRevoke(alice);
  await refetchAuthMeAfterIdle(page);
  await expect(page.getByRole('link', { name: '登录', exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.scrollY);
  const flashed = await page.evaluate(() => Reflect.get(window, '__ch226SkeletonSeen'));
  console.info(JSON.stringify({ before, after, flashed, url: page.url() }));
  await page.screenshot({ path: '/workspace/ch226-evidence/e2e/s5-fixed-authme.png' });
});
