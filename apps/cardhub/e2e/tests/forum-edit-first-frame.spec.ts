/// <reference lib="dom" />
// page.evaluate / addInitScript callbacks run in the browser.
import { writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  apiCreateTopic,
  apiLogin,
  closeEditWindowInDb,
  readPasswords,
  resetRateLimits,
  revokeInDb,
  setEditWindowLeftInDb,
  signInOnPage,
  type ApiSession,
} from './forum-session-helpers';

/**
 * CH-226 §7-10 (v1.3), 26-11～26-13: what the user can see in each frame.
 * An init script samples the page in every requestAnimationFrame callback
 * (the state about to be painted) and on every DOM mutation, from the first
 * byte of the document. CPU is slowed ×4 through CDP for the cold loads.
 */

const RUNS = 20;

type Sample = {
  kind: 'raf' | 'dom';
  t: number;
  path: string;
  skeleton: boolean;
  notAllowed: boolean;
  countdown: boolean;
  expiredAlert: boolean;
  title: string | null;
  body: string | null;
  reply: string | null;
  saveEnabled: boolean | null;
};

declare global {
  interface Window {
    __ch226Samples?: Sample[];
  }
}

function installSampler(): void {
  const samples: Sample[] = [];
  window.__ch226Samples = samples;
  const take = (kind: 'raf' | 'dom') => {
    const root = document.body;
    if (!root) return;
    const text = root.textContent ?? '';
    const title = document.querySelector<HTMLInputElement>('#topic-title');
    const body = document.querySelector<HTMLTextAreaElement>('#topic-body');
    const reply = document.querySelector<HTMLTextAreaElement>('#reply-body');
    const save = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === '保存修改',
    );
    samples.push({
      kind,
      t: performance.now(),
      path: location.pathname,
      skeleton: document.querySelector('main .animate-pulse') !== null,
      notAllowed: text.includes('这个话题已不能编辑'),
      countdown: text.includes('还可编辑'),
      expiredAlert: Array.from(document.querySelectorAll('[role="alert"]')).some((node) =>
        (node.textContent ?? '').includes('已超过 5 分钟编辑时限'),
      ),
      title: title ? title.value : null,
      body: body ? body.value : null,
      reply: reply ? reply.value : null,
      saveEnabled: save ? !save.disabled : null,
    });
  };
  const frame = () => {
    take('raf');
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  new MutationObserver(() => take('dom')).observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
}

async function seed({
  page,
  session,
  draft,
}: {
  page: Page;
  session: ApiSession;
  draft?: { key: string; value: Record<string, string> };
}) {
  await page.addInitScript(
    ({ token, userId, draft }) => {
      localStorage.setItem(
        'cardhub:session',
        JSON.stringify({ token, user: { id: userId, username: 'alice', role: 'user' } }),
      );
      if (draft && sessionStorage.getItem('e2e:draft-seeded') !== '1') {
        sessionStorage.setItem('e2e:draft-seeded', '1');
        sessionStorage.setItem(
          draft.key,
          JSON.stringify({ v: 1, userId, savedAt: Date.now(), ...draft.value }),
        );
      }
    },
    { token: session.token, userId: session.userId, draft },
  );
  await page.addInitScript(installSampler);
}

async function readSamples(page: Page): Promise<Sample[]> {
  return page.evaluate(() => window.__ch226Samples ?? []);
}

/** Frames painted while the page under test is on screen and past its skeleton. */
function paintedAfterSkeleton(samples: Sample[], path: string): Sample[] {
  return samples.filter((s) => s.kind === 'raf' && s.path === path && !s.skeleton);
}

/**
 * Whether the frame shows any of the page's own states. Before the session
 * check resolves the page renders nothing (only the site shell), which is
 * neither a wrong state nor the first state the user sees.
 */
function showsPageState(s: Sample): boolean {
  return (
    s.notAllowed ||
    s.countdown ||
    s.expiredAlert ||
    s.title !== null ||
    s.body !== null ||
    s.reply !== null
  );
}

type ColdRun = { run: number; firstPainted: Sample | undefined; wrong: Sample[]; domWrong: number };

async function coldLoads({
  page,
  path,
  draft,
  session,
  done,
  wrong,
}: {
  page: Page;
  path: string;
  draft: { key: string; value: Record<string, string> };
  session: ApiSession;
  done: (page: Page) => Promise<void>;
  wrong: (sample: Sample) => boolean;
}): Promise<ColdRun[]> {
  const runs: ColdRun[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const tab = await page.context().newPage();
    await seed({ page: tab, session, draft });
    const cdp = await tab.context().newCDPSession(tab);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await tab.goto(path);
    await done(tab);
    // A few more frames after the final state, so a late flip would show.
    await tab.waitForTimeout(300);
    const samples = await readSamples(tab);
    const painted = paintedAfterSkeleton(samples, path);
    runs.push({
      run,
      firstPainted: painted.find(showsPageState),
      wrong: painted.filter(wrong),
      domWrong: samples.filter((s) => s.kind === 'dom' && s.path === path && wrong(s)).length,
    });
    await cdp.detach();
    await tab.close();
  }
  return runs;
}

function summarize(name: string, runs: ColdRun[]) {
  const summary = {
    name,
    runs: runs.length,
    runsWithWrongPaintedFrame: runs.filter((r) => r.wrong.length > 0).length,
    wrongPaintedFrames: runs.reduce((n, r) => n + r.wrong.length, 0),
    runsWithWrongStateInDom: runs.filter((r) => r.domWrong > 0).length,
    runsPaintingNotAllowed: runs.filter((r) => r.wrong.some((s) => s.notAllowed)).length,
    runsPaintingOtherText: runs.filter((r) => r.wrong.some((s) => !s.notAllowed)).length,
    firstPaintedFrames: runs.map((r) => r.firstPainted),
  };
  writeFileSync(test.info().outputPath(`${name}.json`), JSON.stringify(summary, null, 2));
  console.info(
    JSON.stringify({
      name,
      runs: summary.runs,
      runsWithWrongPaintedFrame: summary.runsWithWrongPaintedFrame,
      wrongPaintedFrames: summary.wrongPaintedFrames,
      runsWithWrongStateInDom: summary.runsWithWrongStateInDom,
      runsPaintingNotAllowed: summary.runsPaintingNotAllowed,
      runsPaintingOtherText: summary.runsPaintingOtherText,
      maxWrongFramesInOneRun: Math.max(0, ...runs.map((r) => r.wrong.length)),
    }),
  );
  return summary;
}

let alice: ApiSession;

test.beforeEach(async () => {
  test.setTimeout(300_000);
  await resetRateLimits();
  alice = await apiLogin({ identifier: 'alice', password: readPasswords().userPassword });
});

test('26-12: past the window + valid edit draft, CPU ×4 cold load ×20 → no frame shows notAllowed; the first is the expired form with the draft', async ({
  page,
}) => {
  const topic = await apiCreateTopic({
    session: alice,
    title: `CH-226 首帧 过期 ${Date.now()}`,
    body: '原正文',
  });
  await closeEditWindowInDb(topic.id);
  const runs = await coldLoads({
    page,
    session: alice,
    path: `/forum/${topic.slug}/edit`,
    draft: {
      key: `cardhub:draft:forum:edit:${topic.id}`,
      value: { title: '稿子标题', body: '稿子正文' },
    },
    done: async (tab) => {
      await expect(tab.getByLabel('标题')).toHaveValue('稿子标题');
      await expect(
        tab.getByRole('alert').filter({ hasText: '已超过 5 分钟编辑时限' }),
      ).toBeVisible();
    },
    wrong: (s) => s.notAllowed || (s.title !== null && (s.title !== '稿子标题' || !s.expiredAlert)),
  });
  const summary = summarize('26-12-expired-edit-draft', runs);
  expect(summary.runsWithWrongStateInDom).toBe(0);
  expect(summary.runsWithWrongPaintedFrame).toBe(0);
  for (const run of runs) {
    expect(run.firstPainted).toMatchObject({
      expiredAlert: true,
      title: '稿子标题',
      saveEnabled: false,
    });
  }
});

test('26-13: /forum/new, edit inside the window and reply with a draft, CPU ×4 cold load ×20 each → the first frame already holds the draft', async ({
  page,
}) => {
  const topic = await apiCreateTopic({
    session: alice,
    title: `CH-226 首帧 编辑 ${Date.now()}`,
    body: '原正文',
  });

  const newRuns = await coldLoads({
    page,
    session: alice,
    path: '/forum/new',
    draft: { key: 'cardhub:draft:forum:new', value: { title: '新帖稿子', body: '新帖正文' } },
    done: async (tab) => {
      await expect(tab.getByLabel('标题')).toHaveValue('新帖稿子');
    },
    wrong: (s) => s.title !== null && s.title !== '新帖稿子',
  });
  const editRuns = await coldLoads({
    page,
    session: alice,
    path: `/forum/${topic.slug}/edit`,
    draft: {
      key: `cardhub:draft:forum:edit:${topic.id}`,
      value: { title: '编辑稿子', body: '编辑正文' },
    },
    done: async (tab) => {
      await expect(tab.getByLabel('标题')).toHaveValue('编辑稿子');
    },
    wrong: (s) => s.notAllowed || (s.title !== null && s.title !== '编辑稿子'),
  });
  const replyRuns = await coldLoads({
    page,
    session: alice,
    path: `/forum/${topic.slug}`,
    draft: { key: `cardhub:draft:forum:reply:${topic.id}`, value: { body: '回帖稿子' } },
    done: async (tab) => {
      await expect(tab.locator('#reply-body')).toHaveValue('回帖稿子');
    },
    wrong: (s) => s.reply !== null && s.reply !== '回帖稿子',
  });

  const summaries = [
    summarize('26-13-new-draft', newRuns),
    summarize('26-13-edit-draft', editRuns),
    summarize('26-13-reply-draft', replyRuns),
  ];
  for (const summary of summaries) {
    expect(summary.runsWithWrongStateInDom, summary.name).toBe(0);
    expect(summary.runsWithWrongPaintedFrame, summary.name).toBe(0);
  }
});

for (const delayMs of [0, 1000]) {
  test(`26-11: back from login with the topic still cached and its window closed (bySlug delay ${delayMs}ms) → no frame shows a countdown or an enabled Save`, async ({
    page,
  }) => {
    const topic = await apiCreateTopic({
      session: alice,
      title: `CH-226 首帧 缓存 ${Date.now()}`,
      body: '原正文',
    });
    // 20 seconds of the window left: enough to type and press Save.
    await setEditWindowLeftInDb({ topicId: topic.id, secondsLeft: 20 });
    await seed({ page, session: alice });
    await page.goto(`/forum/${topic.slug}/edit`);
    await expect(page.getByText('还可编辑不到 1 分钟')).toBeVisible();
    await page.getByLabel('标题').fill('缓存稿子');

    // The session ends on Save; the draft is written and the page goes to login.
    await revokeInDb('alice');
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The user takes a while to sign in; the window closes meanwhile. The
    // topic stays in the query cache (fetched again right after sign-out).
    await page.waitForTimeout(23_000);
    await page.route(/\/trpc\/[^?]*forum\.topics\.bySlug/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.continue();
    });
    // Empty the sampler's own array in place; the rAF loop holds a reference to it.
    await page.evaluate(() => {
      window.__ch226Samples?.splice(0);
    });
    await signInOnPage({ page, identifier: 'alice', password: readPasswords().userPassword });
    await expect(page).toHaveURL(new RegExp(`/forum/${topic.slug}/edit$`));
    await expect(
      page.getByRole('alert').filter({ hasText: '已超过 5 分钟编辑时限' }),
    ).toBeVisible();
    await expect(page.getByLabel('标题')).toHaveValue('缓存稿子');
    await page.waitForTimeout(delayMs + 500);

    const path = `/forum/${topic.slug}/edit`;
    const samples = (await readSamples(page)).filter((s) => s.path === path);
    const painted = samples.filter((s) => s.kind === 'raf');
    const summary = {
      name: `26-11-cached-delay-${delayMs}`,
      paintedFrames: painted.length,
      fromCache: painted.length > 0 && !painted.some((s) => s.skeleton),
      countdownFrames: painted.filter((s) => s.countdown).length,
      saveEnabledFrames: painted.filter((s) => s.saveEnabled === true).length,
      countdownInDom: samples.filter((s) => s.countdown).length,
      firstPainted: painted.find(showsPageState),
    };
    writeFileSync(test.info().outputPath(`${summary.name}.json`), JSON.stringify(summary, null, 2));
    console.info(JSON.stringify({ ...summary, firstPainted: undefined }));
    expect(summary.fromCache).toBe(true);
    expect(summary.countdownInDom).toBe(0);
    expect(summary.countdownFrames).toBe(0);
    expect(summary.saveEnabledFrames).toBe(0);
    expect(summary.firstPainted).toMatchObject({ expiredAlert: true });
  });
}

/** The ids in an element's aria-describedby, in order. */
async function describedByIds(locator: Locator): Promise<string[]> {
  const value = await locator.getAttribute('aria-describedby');
  return (value ?? '').split(/\s+/).filter(Boolean);
}

test('26-14: title, body and the reply box are described by the restored line', async ({
  page,
}) => {
  const topic = await apiCreateTopic({
    session: alice,
    title: `CH-226 describedby ${Date.now()}`,
    body: '原正文',
  });
  const cases: Array<{
    path: string;
    key: string;
    value: Record<string, string>;
    fields: string[];
  }> = [
    {
      path: '/forum/new',
      key: 'cardhub:draft:forum:new',
      value: { title: '新帖稿子', body: '新帖正文' },
      fields: ['#topic-title', '#topic-body'],
    },
    {
      path: `/forum/${topic.slug}/edit`,
      key: `cardhub:draft:forum:edit:${topic.id}`,
      value: { title: '编辑稿子', body: '编辑正文' },
      fields: ['#topic-title', '#topic-body'],
    },
    {
      path: `/forum/${topic.slug}`,
      key: `cardhub:draft:forum:reply:${topic.id}`,
      value: { body: '回帖稿子' },
      fields: ['#reply-body'],
    },
  ];
  const evidence: Array<{ path: string; field: string; describedBy: string[]; line: string }> = [];
  for (const c of cases) {
    const tab = await page.context().newPage();
    await seed({ page: tab, session: alice, draft: { key: c.key, value: c.value } });
    await tab.goto(c.path);
    const line = tab.getByText('已恢复未发送的内容。', { exact: true });
    await expect(line).toBeVisible();
    const lineId = await line.getAttribute('id');
    expect(lineId, c.path).toBeTruthy();
    for (const field of c.fields) {
      const ids = await describedByIds(tab.locator(field));
      evidence.push({ path: c.path, field, describedBy: ids, line: lineId ?? '' });
      expect(ids, `${c.path} ${field}`).toContain(lineId);
    }
    await tab.close();
  }
  writeFileSync(
    test.info().outputPath('26-14-describedby.json'),
    JSON.stringify(evidence, null, 2),
  );
  console.info(JSON.stringify(evidence));
});
