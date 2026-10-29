import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { passwordFile } from '../harness';

function readUserPassword(): string {
  const parsed = JSON.parse(readFileSync(passwordFile, 'utf8')) as { userPassword?: string };
  if (!parsed.userPassword) {
    throw new Error('Smoke password file is missing userPassword.');
  }
  return parsed.userPassword;
}

async function signIn(page: Page, identifier: string, password: string): Promise<void> {
  await page.getByLabel('邮箱或用户名').fill(identifier);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
}

test('a bad token on a card opens login and returns to that card', async ({ page }) => {
  const password = readUserPassword();
  await page.addInitScript(() => {
    localStorage.setItem(
      'cardhub:session',
      JSON.stringify({
        token: 'not-a-valid-token',
        user: { id: 'not-real', username: 'alice', role: 'user' },
      }),
    );
  });

  await page.goto('/cards/aurora-knight');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toHaveText('登录已失效，请重新登录。');

  await signIn(page, 'alice', password);
  await expect(page).toHaveURL(/\/cards\/aurora-knight$/);
  await expect(page.getByRole('heading', { level: 1, name: '极光骑士' })).toBeVisible();
});
