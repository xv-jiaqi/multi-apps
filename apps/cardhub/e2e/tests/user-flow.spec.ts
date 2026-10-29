import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { passwordFile } from '../harness';

interface SmokePasswords {
  userPassword: string;
  adminPassword: string;
}

function readPasswords(): SmokePasswords {
  const parsed = JSON.parse(readFileSync(passwordFile, 'utf8')) as Partial<SmokePasswords>;
  if (!parsed.userPassword || !parsed.adminPassword) {
    throw new Error('Smoke password file is missing userPassword or adminPassword.');
  }
  return { userPassword: parsed.userPassword, adminPassword: parsed.adminPassword };
}

async function signIn(page: Page, identifier: string, password: string): Promise<void> {
  await page.getByLabel('邮箱或用户名').fill(identifier);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
}

test('browse, comment, forum, trade, and report handling', async ({ page }) => {
  const passwords = readPasswords();
  const stamp = Date.now().toString(36);
  const comment = `冒烟评论 ${stamp}`;
  const title = `冒烟话题 ${stamp}`;
  const body = `冒烟正文 ${stamp}`;
  const reply = `冒烟回帖 ${stamp}`;
  const note = `冒烟意向 ${stamp}`;
  const contact = `smoke-${stamp}`;
  const reason = `冒烟举报 ${stamp}`;
  let topicUrl = '';

  await test.step('浏览到卡牌', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: '浏览全部系列' }).click();
    await expect(page).toHaveURL(/\/series$/);
    await page.getByRole('link', { name: /天穹黎明/ }).click();
    await expect(page).toHaveURL(/\/series\/celestial-dawn$/);
    await expect(page.getByRole('heading', { level: 1, name: '天穹黎明' })).toBeVisible();
    await page.getByRole('link', { name: /极光骑士/ }).click();
    await expect(page).toHaveURL(/\/cards\/aurora-knight$/);
    await expect(page.getByRole('heading', { level: 1, name: '极光骑士' })).toBeVisible();
  });

  await test.step('登录并评论', async () => {
    await page.getByRole('link', { name: '登录后即可发表评论' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, 'alice', passwords.userPassword);
    await expect(page).toHaveURL(/\/cards\/aurora-knight$/);
    await expect(page.getByRole('link', { name: '@alice 的个人中心' })).toBeVisible();
    await page.getByRole('textbox', { name: '撰写评论' }).fill(comment);
    await page.getByRole('button', { name: '发布评论' }).click();
    const commentItem = page.getByRole('listitem').filter({ hasText: comment });
    await expect(commentItem).toBeVisible();
    await expect(commentItem).toContainText('@alice');
  });

  await test.step('发帖并回帖', async () => {
    await page.getByRole('link', { name: '论坛', exact: true }).click();
    await expect(page).toHaveURL(/\/forum$/);
    await page.getByRole('link', { name: '发布新话题' }).click();
    await expect(page).toHaveURL(/\/forum\/new$/);
    await page.getByLabel('标题').fill(title);
    await page.getByLabel('正文').fill(body);
    await page.getByRole('button', { name: '发布话题' }).click();
    await expect(page).toHaveURL(/\/forum\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
    await expect(page.getByText(body, { exact: true })).toBeVisible();
    topicUrl = page.url();
    await page.getByLabel('撰写回帖').fill(reply);
    await page.getByRole('button', { name: '发布回帖' }).click();
    await expect(page.getByText(reply, { exact: true })).toBeVisible();
  });

  await test.step('发布意向并关闭', async () => {
    await page.goto('/cards/aurora-knight');
    await page.getByRole('link', { name: '发布意向' }).click();
    await expect(page).toHaveURL(/\/trade\/new\?cardSlug=aurora-knight$/);
    await expect(page.getByRole('button', { name: '更换' })).toBeVisible();
    await expect(page.getByText('极光骑士', { exact: true })).toBeVisible();
    await page.getByLabel('联系方式（微信 / QQ / 邮箱…）').fill(contact);
    await page.getByLabel('备注（可选，最多 500 字）').fill(note);
    await page.getByRole('button', { name: '发布意向' }).click();
    await expect(page).toHaveURL(/\/trade$/);
    const listing = page.getByRole('article').filter({ hasText: note });
    await expect(listing).toContainText(contact);
    await listing.getByRole('button', { name: '关闭这条意向' }).click();
    await listing.getByRole('button', { name: '关闭意向', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '意向已关闭' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: note })).toHaveCount(0);
  });

  await test.step('管理员处理举报', async () => {
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('link', { name: '登录', exact: true })).toBeVisible();
    // auth.me stays cached for 5 minutes in this document, so a second login
    // can paint the previous user. A reload drops that cache.
    await page.reload();
    await page.getByRole('link', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, 'admin', passwords.adminPassword);
    await expect(page.getByRole('button', { name: '管理', exact: true })).toBeVisible();

    await page.goto(topicUrl);
    await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
    const topicActions = page
      .getByRole('heading', { level: 3, name: title })
      .locator('..')
      .locator('..');
    await topicActions.getByRole('button', { name: '举报', exact: true }).click();
    await page.getByLabel('请说明举报原因').fill(reason);
    await page.getByRole('button', { name: '提交举报' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '举报已提交，感谢你的协助' }),
    ).toBeVisible();

    await page.getByRole('button', { name: '管理', exact: true }).click();
    await page.getByRole('link', { name: '举报队列', exact: true }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('heading', { level: 1, name: '举报队列' })).toBeVisible();
    const report = page.getByRole('listitem').filter({ hasText: reason });
    await expect(report).toContainText('@admin');
    await report.getByRole('button', { name: '标记已处理' }).click();
    await expect(page.getByRole('status').filter({ hasText: '已标记为已处理' })).toBeVisible();
    await expect(report.getByText('已处理', { exact: true })).toBeVisible();
    await expect(report.getByRole('button', { name: '标记已处理' })).toHaveCount(0);
  });
});
