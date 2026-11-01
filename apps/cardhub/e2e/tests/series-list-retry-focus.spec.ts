import { expect, test, type Route } from '@playwright/test';

const LIST_ERROR = {
  error: {
    message: 'Internal Server Error',
    code: -32603,
    data: {
      code: 'INTERNAL_SERVER_ERROR',
      httpStatus: 500,
      appCode: 'INTERNAL_SERVER_ERROR',
      path: 'cards.listBySeries',
    },
  },
};

function procedureNames(url: string): string[] {
  const leaf = new URL(url).pathname.split('/').pop() ?? '';
  return decodeURIComponent(leaf)
    .split(',')
    .filter((name) => name.length > 0);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

async function readJson(response: { text: () => Promise<string> }): Promise<unknown> {
  return JSON.parse(await response.text());
}

async function failListBySeries(route: Route): Promise<void> {
  const names = procedureNames(route.request().url());
  const index = names.indexOf('cards.listBySeries');
  if (index < 0) {
    await route.continue();
    return;
  }
  if (names.length === 1) {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify([LIST_ERROR]),
    });
    return;
  }

  const upstream = await route.fetch();
  const payload = await readJson(upstream);
  if (!isUnknownArray(payload) || payload.length !== names.length) {
    throw new Error(`cards.listBySeries batch was not an array of ${names.length}`);
  }
  const next = payload.map((item, itemIndex) => (itemIndex === index ? LIST_ERROR : item));
  await route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify(next),
  });
}

test('series list retry keeps focus when listBySeries stays 500', async ({ page }) => {
  await page.route('**/trpc/**', failListBySeries);
  await page.goto('/series/celestial-dawn');
  await expect(page.getByRole('heading', { level: 1, name: '天穹黎明' })).toBeVisible();

  const retry = page
    .getByRole('alert')
    .filter({ has: page.getByRole('heading', { level: 2, name: '出了点问题，请稍后再试' }) })
    .getByRole('button', { name: '重试', exact: true });
  await expect(retry).toBeVisible();
  await retry.focus();
  await page.keyboard.press('Enter');

  await expect(retry).toHaveAttribute('aria-busy', 'true');
  await expect(retry).not.toHaveAttribute('aria-busy');
  await expect(retry).toHaveText('重试');

  const active = await retry.evaluate((node) => {
    const current = node.ownerDocument.activeElement;
    if (current === null || current === node.ownerDocument.body) return 'BODY';
    return `${current.tagName}:${current.textContent ?? ''}`;
  });
  expect(active).toBe('BUTTON:重试');
});
