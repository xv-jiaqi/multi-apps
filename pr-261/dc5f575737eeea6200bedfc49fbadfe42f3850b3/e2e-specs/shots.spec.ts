import { execSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { apiCreateTopic, apiLogin, readPasswords, type ApiSession } from '../tests/helpers';

const OUT = '/workspace/ch226-evidence/shots';
const AXE = '/workspace/ch226-evidence/shots/axe.jsonl';
const axePath = createRequire('/workspace/wt-ch226/apps/cardhub/web/package.json').resolve('axe-core/axe.min.js');
const flush = () => execSync('/home/box/opt/mamba/envs/db/bin/redis-cli -p 6379 FLUSHALL');

const TEXT = {
  zh: { expired: '登录已失效，请重新登录。', restored: '已恢复未发送的内容。', cta: '登录后发布话题', locale: 'zh-CN' },
  en: { expired: 'Your session has ended. Sign in again.', restored: 'Unsent text restored.', cta: 'Sign in to post a topic', locale: 'en-US' },
} as const;
type Lang = keyof typeof TEXT;

let alice: ApiSession;
let slug = '';
writeFileSync(AXE, '');

test.beforeAll(async () => {
  flush();
  alice = await apiLogin({ identifier: 'alice', password: readPasswords().userPassword });
  const admin = await apiLogin({ identifier: 'admin', password: readPasswords().adminPassword });
  const topic = await apiCreateTopic({
    session: admin,
    title: 'CH-226 截图：读帖时登录失效',
    body: Array.from({ length: 6 }, (_, i) => `第 ${i + 1} 段 / Paragraph ${i + 1}.`).join('\n\n'),
  });
  slug = topic.slug;
});

async function prepare({ page, lang, dark, session, draft }: {
  page: Page; lang: Lang; dark: boolean;
  session: 'none' | 'rejected' | 'alice';
  draft?: { key: string; value: Record<string, unknown> };
}) {
  await page.addInitScript(
    ({ locale, theme, session, token, userId, draft }) => {
      if (sessionStorage.getItem('shots:seeded') === '1') return;
      sessionStorage.setItem('shots:seeded', '1');
      localStorage.setItem('cardhub:locale', locale);
      localStorage.setItem('cardhub:theme', theme);
      if (session !== 'none') {
        localStorage.setItem('cardhub:session', JSON.stringify({
          token: session === 'rejected' ? 'not-a-valid-token' : token,
          user: { id: userId, username: 'alice', role: 'user' },
        }));
      }
      if (draft) sessionStorage.setItem(draft.key, JSON.stringify({ ...draft.value, savedAt: Date.now() }));
    },
    { locale: TEXT[lang].locale, theme: dark ? 'dark' : 'light', session, token: alice.token, userId: alice.userId, draft },
  );
}

async function shoot({ page, name }: { page: Page; name: string }) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const axe = Reflect.get(window, 'axe');
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map((v: { id: string; nodes: unknown[] }) => ({ id: v.id, nodes: v.nodes.length }));
  });
  const statuses = await page.getByRole('status').allInnerTexts();
  appendFileSync(AXE, JSON.stringify({ name, url: page.url(), violations, statuses: statuses.filter((s) => s.trim()) }) + '\n');
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

for (const width of [375, 1440]) {
  for (const lang of ['zh', 'en'] as const) {
    for (const dark of [false, true]) {
      const tag = `${width}_${lang}_${dark ? 'dark' : 'light'}`;
      test(`shots ${tag}`, async ({ browser }) => {
        const t = TEXT[lang];
        const newPage = async () => {
          const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: t.locale, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
          return ctx.newPage();
        };

        // 1. List: token rejected while reading → stays, one notice.
        let page = await newPage();
        await prepare({ page, lang, dark, session: 'rejected' });
        await page.goto('/forum');
        await expect(page.getByRole('status').filter({ hasText: t.expired })).toHaveCount(1);
        await shoot({ page, name: `list-expired_${tag}` });
        await page.context().close();

        // 2. Detail: same, notice replaces the login box above the reply area.
        page = await newPage();
        await prepare({ page, lang, dark, session: 'rejected' });
        await page.goto(`/forum/${slug}`);
        await expect(page.getByRole('status').filter({ hasText: t.expired })).toHaveCount(1);
        await shoot({ page, name: `detail-expired_${tag}` });
        await page.context().close();

        // 3. New topic draft restored after login.
        page = await newPage();
        await prepare({ page, lang, dark, session: 'alice', draft: { key: 'cardhub:draft:forum:new', value: { v: 1, userId: alice.userId, title: 'CH-226 草稿标题 / Draft title', body: '登录前没发出去的正文。\nUnsent body.' } } });
        await page.goto('/forum/new');
        await expect(page.getByRole('status').filter({ hasText: t.restored })).toHaveCount(1);
        await shoot({ page, name: `new-restored_${tag}` });
        await page.context().close();

        // 4. Edit draft restored (fresh topic so the 5-minute window is open).
        flush();
        const mine = await apiCreateTopic({ session: alice, title: `CH-226 编辑 ${tag}`, body: '原正文 / Original body' });
        page = await newPage();
        await prepare({ page, lang, dark, session: 'alice', draft: { key: `cardhub:draft:forum:edit:${mine.id}`, value: { v: 1, userId: alice.userId, title: '改过的标题 / Edited title', body: '原正文 / Original body\n\n补充一段 / Added paragraph' } } });
        await page.goto(`/forum/${mine.slug}/edit`);
        await expect(page.getByRole('status').filter({ hasText: t.restored })).toHaveCount(1);
        await shoot({ page, name: `edit-restored_${tag}` });
        await page.context().close();

        // 5. Reply draft restored.
        page = await newPage();
        await prepare({ page, lang, dark, session: 'alice', draft: { key: `cardhub:draft:forum:reply:${mine.id}`, value: { v: 1, userId: alice.userId, body: '回帖内容 / Reply text' } } });
        await page.goto(`/forum/${mine.slug}`);
        await expect(page.getByRole('status').filter({ hasText: t.restored })).toHaveCount(1);
        await page.locator('#reply-body').scrollIntoViewIfNeeded();
        await shoot({ page, name: `reply-restored_${tag}` });
        await page.context().close();

        // 6. Anonymous 登录发帖 (keyboard focus visible) → login → straight to /forum/new.
        page = await newPage();
        await prepare({ page, lang, dark, session: 'none' });
        await page.goto('/forum');
        const cta = page.getByRole('link', { name: t.cta });
        await cta.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(cta).toBeFocused();
        await shoot({ page, name: `cta-focus_${tag}` });
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/login$/);
        flush();
        await page.locator('input[autocomplete="username"]').fill('alice');
        await page.locator('input[autocomplete="current-password"]').fill(readPasswords().userPassword);
        await page.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(/\/forum\/new$/);
        await expect(page.locator('form input').first()).toBeVisible();
        await shoot({ page, name: `cta-landed-new_${tag}` });
        await page.context().close();
      });
    }
  }
}
