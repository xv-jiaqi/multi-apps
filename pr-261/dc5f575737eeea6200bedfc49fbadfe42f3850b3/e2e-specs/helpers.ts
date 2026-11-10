import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { apiOrigin, passwordFile } from '/workspace/wt-ch226/apps/cardhub/e2e/harness.ts';

type Passwords = { userPassword: string; adminPassword: string };

function readField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  return Reflect.get(value, key);
}

function readString(value: unknown, key: string): string {
  const field = readField(value, key);
  if (typeof field !== 'string') throw new Error(`Expected string field ${key}`);
  return field;
}

export function readPasswords(): Passwords {
  const parsed: unknown = JSON.parse(readFileSync(passwordFile, 'utf8'));
  return {
    userPassword: readString(parsed, 'userPassword'),
    adminPassword: readString(parsed, 'adminPassword'),
  };
}

async function call({
  path,
  input,
  token,
}: {
  path: string;
  input: unknown;
  token?: string;
}): Promise<unknown> {
  const response = await fetch(`${apiOrigin}/trpc/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  });
  const json: unknown = await response.json();
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(json)}`);
  return readField(readField(json, 'result'), 'data');
}

export type ApiSession = { token: string; userId: string };

export async function apiLogin({
  identifier,
  password,
}: {
  identifier: string;
  password: string;
}): Promise<ApiSession> {
  const data = await call({ path: 'auth.login', input: { identifier, password } });
  return { token: readString(data, 'token'), userId: readString(readField(data, 'user'), 'id') };
}

export async function apiCreateTopic({
  session,
  title,
  body,
}: {
  session: ApiSession;
  title: string;
  body: string;
}): Promise<{ id: string; slug: string }> {
  const data = await call({
    path: 'forum.topics.create',
    input: { title, body },
    token: session.token,
  });
  return { id: readString(data, 'id'), slug: readString(data, 'slug') };
}

export async function apiReply({
  session,
  topicId,
  body,
}: {
  session: ApiSession;
  topicId: string;
  body: string;
}): Promise<void> {
  await call({ path: 'forum.replies.create', input: { topicId, body }, token: session.token });
}

/** Revokes every token for this user (CH-212 tokenVersion), like signing out on another device. */
export async function apiRevoke(session: ApiSession): Promise<void> {
  await call({ path: 'auth.signOutAll', input: undefined, token: session.token });
}

export async function signInOnPage({
  page,
  identifier,
  password,
}: {
  page: Page;
  identifier: string;
  password: string;
}): Promise<void> {
  await page.getByLabel('邮箱或用户名').fill(identifier);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

/** Puts a session the server will reject into storage before the app boots. */
export async function seedRejectedSession({
  page,
  userId,
}: {
  page: Page;
  userId: string;
}): Promise<void> {
  await page.addInitScript((id) => {
    localStorage.setItem(
      'cardhub:session',
      JSON.stringify({
        token: 'not-a-valid-token',
        user: { id, username: 'alice', role: 'user' },
      }),
    );
  }, userId);
}

/**
 * auth.me has a 5-minute staleTime. Moving the clock past it and firing
 * visibilitychange is what a user returning to the tab does.
 */
export async function refetchAuthMeAfterIdle(page: Page): Promise<void> {
  await page.clock.fastForward('06:00');
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
}

export async function readDraftKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('cardhub:draft:forum:')) keys.push(key);
    }
    return keys.sort();
  });
}

export async function expectNoSkeletonSince(page: Page): Promise<void> {
  const flashed = await page.evaluate(() => Reflect.get(window, '__ch226SkeletonSeen') === true);
  expect(flashed).toBe(false);
}

/** Records whether any skeleton (animate-pulse) node mounts after this call. */
export async function watchForSkeleton(page: Page): Promise<void> {
  await page.evaluate(() => {
    Reflect.set(window, '__ch226SkeletonSeen', false);
    const observer = new MutationObserver(() => {
      if (document.querySelector('.animate-pulse')) Reflect.set(window, '__ch226SkeletonSeen', true);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * Fault isolation for the §5 probe: in any batch that carries
 * notifications.unreadCount, answer that one procedure with { count: 0 } so
 * auth.me is the only rejected request (the CH-212 §6-3 background case).
 */
export async function onlyAuthMeRejects(page: Page): Promise<void> {
  await page.route(/\/trpc\/[^?]*notifications\.unreadCount/, async (route) => {
    const response = await route.fetch();
    const url = new URL(route.request().url());
    const procedures = url.pathname.replace(/^.*\/trpc\//, '').split(',');
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      await route.fulfill({ response });
      return;
    }
    const patched = body.map((item: unknown, index) =>
      procedures[index] === 'notifications.unreadCount' ? { result: { data: { count: 0 } } } : item,
    );
    const status = patched.some((item: unknown) => readField(item, 'error') !== undefined) ? 207 : 200;
    await route.fulfill({ response, status, json: patched });
  });
}

import pg from 'pg';
import { databaseUrl } from '/workspace/wt-ch226/apps/cardhub/e2e/harness.ts';

/** Same effect as "sign out everywhere" from another device, without a login. */
export async function revokeInDb(username: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('UPDATE users SET "tokenVersion" = "tokenVersion" + 1 WHERE username = $1', [
      username,
    ]);
  } finally {
    await client.end();
  }
}

export async function signInViaStorage({
  page,
  session,
  username,
}: {
  page: Page;
  session: ApiSession;
  username: string;
}): Promise<void> {
  await page.addInitScript(
    ({ token, id, name }) => {
      if (sessionStorage.getItem('e2e:seeded') === '1') return;
      sessionStorage.setItem('e2e:seeded', '1');
      localStorage.setItem(
        'cardhub:session',
        JSON.stringify({ token, user: { id, username: name, role: 'user' } }),
      );
    },
    { token: session.token, id: session.userId, name: username },
  );
}

export function statusesWithText(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text });
}

export const SESSION_EXPIRED = '登录已失效，请重新登录。';
export const RESTORED = '已恢复未发送的内容。';
