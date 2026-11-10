/// <reference lib="dom" />
// page.evaluate callbacks run in the browser.
import { expect, test, type Page } from '@playwright/test';
import {
  apiCreateTopic,
  apiLogin,
  readDraftKeys,
  readPasswords,
  revokeInDb,
  RESTORED,
  SESSION_EXPIRED,
  signInOnPage,
  signInViaStorage,
  statusesWithText,
  resetRateLimits,
  closeEditWindowInDb,
} from './forum-session-helpers';

async function expectLoginWithExpiredNotice(page: Page) {
  await expect(page).toHaveURL(/\/login$/);
  await expect(statusesWithText(page, SESSION_EXPIRED)).toHaveCount(1);
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  await resetRateLimits();
});

test('26-4 /forum/new: submit after expiry → login with sessionExpired → same text back → publish clears the key', async ({
  page,
}) => {
  const alice = await apiLogin({ identifier: 'alice', password: readPasswords().userPassword });
  await signInViaStorage({ page, session: alice, username: 'alice' });
  await page.goto('/forum/new');
  const title = `CH-226 新帖 ${Date.now()}`;
  const body = '第一行\n\n  缩进的第二行 **粗体** @alice\n末尾有空格  ';
  await page.getByLabel('标题').fill(title);
  await page.getByLabel('正文').fill(body);

  await revokeInDb('alice');
  await page.getByRole('button', { name: '发布话题' }).click();

  await expectLoginWithExpiredNotice(page);
  expect(await readDraftKeys(page)).toEqual(['cardhub:draft:forum:new']);
  await signInOnPage({ page, identifier: 'alice', password: readPasswords().userPassword });
  await expect(page).toHaveURL(/\/forum\/new$/);
  await expect(page.getByLabel('标题')).toHaveValue(title);
  await expect(page.getByLabel('正文')).toHaveValue(body);
  await expect(page.getByLabel('标题')).toBeFocused();
  await expect(statusesWithText(page, RESTORED)).toHaveCount(1);
  expect(await readDraftKeys(page)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('26-4-new-restored.png') });

  await page.getByRole('button', { name: '发布话题' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  expect(await readDraftKeys(page)).toEqual([]);
});

test('26-4 /forum/:slug/edit: save after expiry → login → edited text back (Save enabled) → save clears the key', async ({
  page,
}) => {
  const alice = await apiLogin({ identifier: 'alice', password: readPasswords().userPassword });
  const topic = await apiCreateTopic({
    session: alice,
    title: `CH-226 编辑 ${Date.now()}`,
    body: '原正文',
  });
  await signInViaStorage({ page, session: alice, username: 'alice' });
  await page.goto(`/forum/${topic.slug}/edit`);
  await expect(page.getByLabel('标题')).toBeFocused();
  await page.getByLabel('标题').fill('改过的标题');
  await page.getByLabel('正文').fill('原正文\n\n补充一段');

  await revokeInDb('alice');
  await page.getByRole('button', { name: '保存修改' }).click();

  await expectLoginWithExpiredNotice(page);
  expect(await readDraftKeys(page)).toEqual([`cardhub:draft:forum:edit:${topic.id}`]);
  await signInOnPage({ page, identifier: 'alice', password: readPasswords().userPassword });
  await expect(page).toHaveURL(new RegExp(`/forum/${topic.slug}/edit$`));
  await expect(page.getByLabel('标题')).toHaveValue('改过的标题');
  await expect(page.getByLabel('正文')).toHaveValue('原正文\n\n补充一段');
  await expect(page.getByLabel('标题')).toBeFocused();
  await expect(statusesWithText(page, RESTORED)).toHaveCount(1);
  await expect(page.getByRole('button', { name: '保存修改' })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('26-4-edit-restored.png') });

  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '改过的标题' })).toBeVisible();
  expect(await readDraftKeys(page)).toEqual([]);
});

test('26-4 reply: submit after expiry → login → reply back in #reply-body → posting clears the key', async ({
  page,
}) => {
  const alice = await apiLogin({ identifier: 'alice', password: readPasswords().userPassword });
  const topic = await apiCreateTopic({
    session: alice,
    title: `CH-226 回帖 ${Date.now()}`,
    body: '正文',
  });
  await signInViaStorage({ page, session: alice, username: 'alice' });
  await page.goto(`/forum/${topic.slug}`);
  const reply = '回帖内容\n第二行';
  await page.locator('#reply-body').fill(reply);

  await revokeInDb('alice');
  await page.getByRole('button', { name: '发布回帖' }).click();

  await expectLoginWithExpiredNotice(page);
  expect(await readDraftKeys(page)).toEqual([`cardhub:draft:forum:reply:${topic.id}`]);
  await signInOnPage({ page, identifier: 'alice', password: readPasswords().userPassword });
  await expect(page).toHaveURL(new RegExp(`/forum/${topic.slug}$`));
  await expect(page.locator('#reply-body')).toHaveValue(reply);
  await expect(page.locator('#reply-body')).toBeFocused();
  await expect(statusesWithText(page, RESTORED)).toHaveCount(1);
  const describedBy = await page.locator('#reply-body').getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(RESTORED);
  await page.screenshot({ path: test.info().outputPath('26-4-reply-restored.png') });

  await page.getByRole('button', { name: '发布回帖' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '回帖内容' })).toBeVisible();
  await expect(statusesWithText(page, RESTORED)).toHaveCount(0);
  expect(await readDraftKeys(page)).toEqual([]);
});

test('§7-6 v1.2: the author comes back after the edit window with a valid draft → expired form, text restored, Save disabled', async ({
  page,
}) => {
  const alice = await apiLogin({ identifier: 'alice', password: readPasswords().userPassword });
  const topic = await apiCreateTopic({
    session: alice,
    title: `CH-226 过期编辑 ${Date.now()}`,
    body: '原正文',
  });
  await signInViaStorage({ page, session: alice, username: 'alice' });
  await page.goto(`/forum/${topic.slug}/edit`);
  await page.getByLabel('标题').fill('期限过后的标题');
  await page.getByLabel('正文').fill('期限过后还想留住的正文');

  // The window closes while the user types (the page entered while editable),
  // then the session ends on Save.
  await closeEditWindowInDb(topic.id);
  await revokeInDb('alice');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expectLoginWithExpiredNotice(page);

  await signInOnPage({ page, identifier: 'alice', password: readPasswords().userPassword });
  await expect(page).toHaveURL(new RegExp(`/forum/${topic.slug}/edit$`));
  await expect(page.getByText('这个话题已不能编辑')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: '已超过 5 分钟编辑时限' })).toBeVisible();
  await expect(page.getByLabel('标题')).toHaveValue('期限过后的标题');
  await expect(page.getByLabel('正文')).toHaveValue('期限过后还想留住的正文');
  await expect(page.getByLabel('标题')).toBeFocused();
  await expect(statusesWithText(page, RESTORED)).toHaveCount(1);
  await expect(page.getByRole('button', { name: '保存修改' })).toBeDisabled();
  expect(await readDraftKeys(page)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('7-6-expired-edit-restored.png') });
});
