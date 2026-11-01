import { expect, test, type Locator, type Route } from '@playwright/test';
import { waitUntil } from '../../test-utils/wait-until.ts';

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

function createRelease(): { promise: Promise<void>; release: () => void } {
  let release = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  return { promise, release };
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

async function activeLabel(button: Locator): Promise<string> {
  return button.evaluate((node) => {
    const current = node.ownerDocument.activeElement;
    if (current === null || current === node.ownerDocument.body) return 'BODY';
    return `${current.tagName}:${current.textContent ?? ''}`;
  });
}

test('series list retry keeps focus when listBySeries stays 500', async ({ page }) => {
  const gate = createRelease();
  let holdNextList = false;
  let held = false;
  let listRequests = 0;

  await page.route('**/trpc/**', async (route) => {
    const names = procedureNames(route.request().url());
    const isList = names.includes('cards.listBySeries');
    if (isList) listRequests += 1;
    if (holdNextList && !held && isList) {
      held = true;
      await gate.promise;
    }
    await failListBySeries(route);
  });

  try {
    await page.goto('/series/celestial-dawn');
    await expect(page.getByRole('heading', { level: 1, name: '天穹黎明' })).toBeVisible();

    const retry = page
      .getByRole('alert')
      .filter({ has: page.getByRole('heading', { level: 2, name: '出了点问题，请稍后再试' }) })
      .getByRole('button');
    await expect(retry).toHaveText('重试');
    const requestsBeforeRetry = listRequests;
    await retry.focus();
    holdNextList = true;
    await page.keyboard.press('Enter');

    const busy = await waitUntil(
      async () => ({
        requests: listRequests,
        text: await retry.textContent(),
        ariaBusy: await retry.getAttribute('aria-busy'),
      }),
      (sample) =>
        sample.requests > requestsBeforeRetry &&
        sample.text === '重试中…' &&
        sample.ariaBusy === 'true',
      'list retry request in flight',
    );
    expect(busy.requests).toBeGreaterThan(requestsBeforeRetry);
    expect(await activeLabel(retry)).toBe('BUTTON:重试中…');

    gate.release();

    await waitUntil(
      async () => ({
        text: await retry.textContent(),
        ariaBusy: await retry.getAttribute('aria-busy'),
      }),
      (sample) => sample.text === '重试' && sample.ariaBusy !== 'true',
      'list retry settled',
    );
    expect(await activeLabel(retry)).toBe('BUTTON:重试');
  } finally {
    gate.release();
  }
});
