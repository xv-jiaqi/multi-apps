import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Profiler } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { APP_ERROR_CODES } from '@repo/shared';
import { rootStore } from '../stores/root-store';

/**
 * CH-226 §7 at page level: what is stored, when, and what the user sees
 * after coming back. Network is faked at the tRPC hook boundary; storage,
 * routing, the expiry watcher and the forms are real.
 */

type MutationHandlers = {
  onSuccess?: (data: unknown) => unknown;
  onError?: (error: unknown) => unknown;
};
type MutateCall = { input: unknown; handlers: MutationHandlers };

const calls = vi.hoisted(() => ({
  create: [] as MutateCall[],
  update: [] as MutateCall[],
  reply: [] as MutateCall[],
  storedAtMutate: [] as Array<string | null>,
}));

const TOPIC_ID = '11111111-1111-4111-a111-111111111111';
const NEW_KEY = 'cardhub:draft:forum:new';
const EDIT_KEY = `cardhub:draft:forum:edit:${TOPIC_ID}`;
const REPLY_KEY = `cardhub:draft:forum:reply:${TOPIC_ID}`;
const RESTORED = '已恢复未发送的内容。';
const SESSION_EXPIRED = '登录已失效，请重新登录。';

/** When the cached bySlug data was fetched (TanStack `dataUpdatedAt`). */
const topicMeta = vi.hoisted(() => ({ dataUpdatedAt: 0 }));

const topic = vi.hoisted(() => ({
  current: {
    id: '11111111-1111-4111-a111-111111111111',
    slug: 'test-topic',
    title: 'Original title',
    body: 'Original body',
    pinned: false,
    editedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    editableUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
    serverNow: new Date().toISOString(),
    author: { id: 'u1', username: 'alice' },
    replyCount: 0,
    replies: [],
    replyNextCursor: null,
  },
}));

function recordMutation(bucket: MutateCall[], key: string) {
  return (handlers: MutationHandlers) => ({
    mutate: (input: unknown) => {
      calls.storedAtMutate.push(window.sessionStorage.getItem(key));
      bucket.push({ input, handlers });
    },
    isPending: false,
  });
}

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    useUtils: () => ({
      forum: {
        topics: {
          bySlug: { invalidate: vi.fn(async () => undefined), setData: vi.fn() },
          list: { invalidate: vi.fn(async () => undefined) },
        },
        replies: {
          list: {
            invalidate: vi.fn(async () => undefined),
            reset: vi.fn(async () => undefined),
            setInfiniteData: vi.fn(),
            fetch: vi.fn(),
          },
        },
      },
    }),
    reports: { create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isFetching: false,
          isError: false,
          isSuccess: false,
          refetch: vi.fn(),
        }),
      },
    },
    forum: {
      topics: {
        bySlug: {
          useQuery: () => ({
            isLoading: false,
            isError: false,
            error: null,
            data: topic.current,
            dataUpdatedAt: topicMeta.dataUpdatedAt,
          }),
        },
        create: { useMutation: recordMutation(calls.create, 'cardhub:draft:forum:new') },
        update: {
          useMutation: recordMutation(
            calls.update,
            'cardhub:draft:forum:edit:11111111-1111-4111-a111-111111111111',
          ),
        },
        delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        setPinned: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      replies: {
        list: {
          useInfiniteQuery: () => ({
            data: { pages: [], pageParams: [] },
            hasNextPage: false,
            isFetchingNextPage: false,
            isLoading: false,
            isFetching: false,
            isSuccess: true,
            isFetchNextPageError: false,
            fetchNextPage: vi.fn(),
          }),
        },
        create: {
          useMutation: recordMutation(
            calls.reply,
            'cardhub:draft:forum:reply:11111111-1111-4111-a111-111111111111',
          ),
        },
        delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  },
}));

import { ForumDetailPage } from './forum-detail';
import { ForumEditPage } from './forum-edit';
import { ForumNewPage } from './forum-new';
import { SessionExpiryWatcher } from '../components/session-expiry-watcher';
import { noteTrpcFailure, noteTrpcQueryFailure } from '../lib/session-expiry';
import { resetSessionExpiryRedirectForTests } from '../lib/session-expiry-redirect';
import { resetForumSessionNoticeForTests } from '../lib/forum-session-notice';

function rejected(path: string) {
  return {
    data: { code: 'UNAUTHORIZED', httpStatus: 401, appCode: APP_ERROR_CODES.UNAUTHORIZED, path },
  };
}

const rateLimited = { data: { code: 'TOO_MANY_REQUESTS', appCode: 'RATE_LIMITED' } };

function LoginProbe() {
  const location = useLocation();
  return <p data-testid="login">login|{JSON.stringify(location.state)}</p>;
}

/** What a user could see after one React commit (CH-226 §7-10). */
type Frame = {
  skeleton: boolean;
  notAllowed: boolean;
  countdown: boolean;
  expiredAlert: boolean;
  title: string | null;
  body: string | null;
  reply: string | null;
  saveEnabled: boolean | null;
};

function snapshotFrame(): Frame {
  const text = document.body.textContent ?? '';
  const title = document.querySelector<HTMLInputElement>('#topic-title');
  const body = document.querySelector<HTMLTextAreaElement>('#topic-body');
  const reply = document.querySelector<HTMLTextAreaElement>('#reply-body');
  const save = screen.queryByRole('button', { name: '保存修改' });
  return {
    skeleton: document.querySelector('.animate-pulse') !== null,
    notAllowed: text.includes('这个话题已不能编辑'),
    countdown: text.includes('还可编辑'),
    expiredAlert: screen
      .queryAllByRole('alert')
      .some((node) => node.textContent?.includes('已超过 5 分钟编辑时限') ?? false),
    title: title?.value ?? null,
    body: body?.value ?? null,
    reply: reply?.value ?? null,
    saveEnabled: save === null ? null : !save.hasAttribute('disabled'),
  };
}

/** Every commit, in order. A Profiler's onRender runs after React has written the DOM. */
const frames: Frame[] = [];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionExpiryWatcher />
      <Profiler id="page" onRender={() => frames.push(snapshotFrame())}>
        <Routes>
          <Route path="/forum" element={<p>forum list</p>} />
          <Route path="/forum/new" element={<ForumNewPage />} />
          <Route path="/forum/:slug" element={<ForumDetailPage />} />
          <Route path="/forum/:slug/edit" element={<ForumEditPage />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </Profiler>
    </MemoryRouter>,
  );
}

function storeDraft(key: string, value: Record<string, unknown>) {
  window.sessionStorage.setItem(key, JSON.stringify({ v: 1, savedAt: Date.now(), ...value }));
}

function storedJson(key: string): unknown {
  const raw = window.sessionStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}

function signInAs(id: string) {
  rootStore.session.signIn(`token-${id}`, { id, username: id, role: 'user' });
}

function restoredLine(): HTMLElement | undefined {
  return screen.queryAllByRole('status').find((node) => node.textContent === RESTORED);
}

beforeEach(() => {
  resetSessionExpiryRedirectForTests();
  resetForumSessionNoticeForTests();
  window.sessionStorage.clear();
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  signInAs('u1');
  calls.create.length = 0;
  calls.update.length = 0;
  calls.reply.length = 0;
  calls.storedAtMutate.length = 0;
  topic.current = {
    ...topic.current,
    editableUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
    serverNow: new Date().toISOString(),
  };
  topicMeta.dataUpdatedAt = Date.now();
  frames.length = 0;
});

describe('/forum/new draft', () => {
  it('26-4: restores title and body, focuses the title, shows forum.draft.restored, deletes the key', () => {
    storeDraft(NEW_KEY, { userId: 'u1', title: '我的标题', body: '我的正文\n第二行' });
    renderAt('/forum/new');

    const title = screen.getByLabelText('标题');
    expect(title).toHaveValue('我的标题');
    expect(screen.getByLabelText('正文')).toHaveValue('我的正文\n第二行');
    expect(document.activeElement).toBe(title);
    const line = restoredLine();
    expect(line).toBeDefined();
    expect(title).toHaveAttribute('aria-describedby', line?.id);
    expect(window.sessionStorage.getItem(NEW_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: '发布话题' })).toBeEnabled();
  });

  it('§7-8: the restored line clears on the first edit', () => {
    storeDraft(NEW_KEY, { userId: 'u1', title: 'T', body: 'B' });
    renderAt('/forum/new');
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: 'B!' } });
    expect(restoredLine()).toBeUndefined();
    expect(screen.getByLabelText('标题')).not.toHaveAttribute('aria-describedby');
  });

  it('26-5: another account’s draft is not restored and is deleted', () => {
    storeDraft(NEW_KEY, { userId: 'someone-else', title: 'T', body: 'B' });
    renderAt('/forum/new');
    expect(screen.getByLabelText('标题')).toHaveValue('');
    expect(restoredLine()).toBeUndefined();
    expect(window.sessionStorage.getItem(NEW_KEY)).toBeNull();
  });

  it('26-4 §7-4a: submit writes the draft before the request; success deletes it', async () => {
    const user = userEvent.setup();
    renderAt('/forum/new');
    await user.type(screen.getByLabelText('标题'), '标题');
    await user.type(screen.getByLabelText('正文'), '正文');
    await user.click(screen.getByRole('button', { name: '发布话题' }));

    expect(calls.storedAtMutate).toHaveLength(1);
    expect(JSON.parse(calls.storedAtMutate[0] ?? 'null')).toMatchObject({
      v: 1,
      userId: 'u1',
      title: '标题',
      body: '正文',
    });
    act(() => {
      calls.create[0]?.handlers.onSuccess?.({ slug: 'new-topic' });
    });
    expect(window.sessionStorage.getItem(NEW_KEY)).toBeNull();
  });

  it('§7-7: a failure that is not an expired session deletes the draft; an expired one keeps it', async () => {
    const user = userEvent.setup();
    renderAt('/forum/new');
    await user.type(screen.getByLabelText('标题'), '标题');
    await user.type(screen.getByLabelText('正文'), '正文');
    await user.click(screen.getByRole('button', { name: '发布话题' }));
    act(() => {
      calls.create[0]?.handlers.onError?.(rateLimited);
    });
    expect(window.sessionStorage.getItem(NEW_KEY)).toBeNull();
    expect(screen.getByLabelText('正文')).toHaveValue('正文');

    await user.click(screen.getByRole('button', { name: '发布话题' }));
    act(() => {
      noteTrpcFailure(rejected('forum.topics.create'));
      calls.create[1]?.handlers.onError?.(rejected('forum.topics.create'));
    });
    expect(screen.getByTestId('login')).toHaveTextContent(
      'login|{"from":"/forum/new","notice":"sessionExpired"}',
    );
    expect(storedJson(NEW_KEY)).toMatchObject({ userId: 'u1', title: '标题', body: '正文' });
  });

  it('§7-4b: a background expiry while typing saves the text, then goes to login', async () => {
    const user = userEvent.setup();
    renderAt('/forum/new');
    await user.type(screen.getByLabelText('正文'), '还没点发布');
    act(() => noteTrpcQueryFailure(rejected('auth.me')));
    expect(screen.getByTestId('login')).toHaveTextContent('"notice":"sessionExpired"');
    expect(storedJson(NEW_KEY)).toMatchObject({
      v: 1,
      userId: 'u1',
      title: '',
      body: '还没点发布',
    });
  });

  it('§7-4: an empty form writes nothing when the session ends', () => {
    renderAt('/forum/new');
    act(() => noteTrpcQueryFailure(rejected('auth.me')));
    expect(window.sessionStorage.getItem(NEW_KEY)).toBeNull();
  });

  it('26-7: Cancel deletes the draft', async () => {
    const user = userEvent.setup();
    storeDraft(NEW_KEY, { userId: 'u1', title: 'T', body: 'B' });
    renderAt('/forum/new');
    await user.click(screen.getByRole('button', { name: '发布话题' }));
    expect(window.sessionStorage.getItem(NEW_KEY)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(window.sessionStorage.getItem(NEW_KEY)).toBeNull();
    expect(screen.getByText('forum list')).toBeInTheDocument();
  });

  it('§7-5: a banned user gets no form, and the draft is deleted', () => {
    rootStore.session.signIn('token-u1', {
      id: 'u1',
      username: 'u1',
      role: 'user',
      bannedAt: '2026-11-01T00:00:00.000Z',
    });
    storeDraft(NEW_KEY, { userId: 'u1', title: 'T', body: 'B' });
    renderAt('/forum/new');
    expect(screen.queryByLabelText('标题')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(NEW_KEY)).toBeNull();
  });
});

describe('/forum/:slug/edit draft', () => {
  it('26-4 §7-6: restores into the current fields so Save stays enabled', () => {
    storeDraft(EDIT_KEY, { userId: 'u1', title: 'Edited title', body: 'Edited body' });
    renderAt('/forum/test-topic/edit');

    const title = screen.getByLabelText('标题');
    expect(title).toHaveValue('Edited title');
    expect(screen.getByLabelText('正文')).toHaveValue('Edited body');
    expect(document.activeElement).toBe(title);
    expect(restoredLine()).toBeDefined();
    expect(screen.getByRole('button', { name: '保存修改' })).toBeEnabled();
    expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull();
  });

  it('§7-4a: submit writes the edit draft before the request; success deletes it', async () => {
    const user = userEvent.setup();
    renderAt('/forum/test-topic/edit');
    await user.type(screen.getByLabelText('正文'), ' more');
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    expect(JSON.parse(calls.storedAtMutate[0] ?? 'null')).toMatchObject({
      userId: 'u1',
      title: 'Original title',
      body: 'Original body more',
    });
    await act(async () => {
      await calls.update[0]?.handlers.onSuccess?.({});
    });
    expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull();
  });

  it('26-7: Cancel deletes the edit draft', async () => {
    const user = userEvent.setup();
    storeDraft(EDIT_KEY, { userId: 'u1', title: 'T', body: 'B' });
    renderAt('/forum/test-topic/edit');
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull();
  });

  it('§7-5: no form for someone who is not the author, so the draft is deleted', () => {
    signInAs('u2');
    storeDraft(EDIT_KEY, { userId: 'u2', title: 'T', body: 'B' });
    renderAt('/forum/test-topic/edit');
    expect(screen.queryByLabelText('标题')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull();
  });

  describe('§7-6 v1.2: the author comes back after the edit window', () => {
    beforeEach(() => {
      topic.current = {
        ...topic.current,
        editableUntil: new Date(Date.now() - 60_000).toISOString(),
        serverNow: new Date().toISOString(),
      };
    });

    it('a valid draft shows the expired form with the text restored and Save disabled', () => {
      storeDraft(EDIT_KEY, { userId: 'u1', title: 'Edited title', body: 'Edited body' });
      renderAt('/forum/test-topic/edit');

      expect(screen.queryByText('这个话题已不能编辑')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('已超过 5 分钟编辑时限');
      const title = screen.getByLabelText('标题');
      expect(title).toHaveValue('Edited title');
      expect(screen.getByLabelText('正文')).toHaveValue('Edited body');
      expect(document.activeElement).toBe(title);
      expect(restoredLine()).toBeDefined();
      expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled();
      expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull();
    });

    it('with no draft it stays not-editable', () => {
      renderAt('/forum/test-topic/edit');
      expect(screen.getByText('这个话题已不能编辑')).toBeInTheDocument();
      expect(screen.queryByLabelText('标题')).not.toBeInTheDocument();
    });

    it('a draft older than 60 minutes is deleted and the page stays not-editable', () => {
      storeDraft(EDIT_KEY, {
        userId: 'u1',
        title: 'Old',
        body: 'Old',
        savedAt: Date.now() - 60 * 60_000 - 1,
      });
      renderAt('/forum/test-topic/edit');
      expect(screen.getByText('这个话题已不能编辑')).toBeInTheDocument();
      expect(screen.queryByLabelText('标题')).not.toBeInTheDocument();
      expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull();
    });

    it('another account’s draft is deleted and the page stays not-editable', () => {
      storeDraft(EDIT_KEY, { userId: 'u9', title: 'T', body: 'B' });
      renderAt('/forum/test-topic/edit');
      expect(screen.getByText('这个话题已不能编辑')).toBeInTheDocument();
      expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull();
    });
  });
});

describe('/forum/:slug reply draft', () => {
  it('26-4: restores the reply, focuses #reply-body and links it to forum.draft.restored', () => {
    storeDraft(REPLY_KEY, { userId: 'u1', body: '我的回帖' });
    renderAt('/forum/test-topic');

    const field = screen.getByLabelText('撰写回帖');
    expect(field).toHaveValue('我的回帖');
    expect(field).toHaveAttribute('id', 'reply-body');
    expect(document.activeElement).toBe(field);
    expect(field).toHaveClass('scroll-mt-20');
    const line = restoredLine();
    expect(line).toBeDefined();
    expect(field).toHaveAttribute('aria-describedby', line?.id);
    expect(window.sessionStorage.getItem(REPLY_KEY)).toBeNull();
  });

  it('26-5: another account’s reply draft is deleted, not shown', () => {
    storeDraft(REPLY_KEY, { userId: 'u9', body: '别人的' });
    renderAt('/forum/test-topic');
    expect(screen.getByLabelText('撰写回帖')).toHaveValue('');
    expect(window.sessionStorage.getItem(REPLY_KEY)).toBeNull();
  });

  it('26-4 §7-4a: submit writes the reply draft first; success deletes it and clears the line', async () => {
    const user = userEvent.setup();
    storeDraft(REPLY_KEY, { userId: 'u1', body: '我的回帖' });
    renderAt('/forum/test-topic');
    await user.click(screen.getByRole('button', { name: '发布回帖' }));
    expect(JSON.parse(calls.storedAtMutate[0] ?? 'null')).toEqual({
      v: 1,
      userId: 'u1',
      savedAt: expect.any(Number),
      body: '我的回帖',
    });
    await act(async () => {
      await calls.reply[0]?.handlers.onSuccess?.({
        id: 'r-new',
        body: '我的回帖',
        createdAt: new Date().toISOString(),
        author: { id: 'u1', username: 'u1' },
      });
    });
    expect(window.sessionStorage.getItem(REPLY_KEY)).toBeNull();
    expect(restoredLine()).toBeUndefined();
  });

  it('26-3: focus in the reply box, silent expiry → focus on the §6 notice, text saved, URL kept', async () => {
    const user = userEvent.setup();
    renderAt('/forum/test-topic?x=1#replies');
    await user.type(screen.getByLabelText('撰写回帖'), '打到一半');
    expect(document.activeElement).toHaveAttribute('id', 'reply-body');

    act(() => noteTrpcQueryFailure(rejected('auth.me')));

    const notice = screen
      .getAllByRole('status')
      .find((node) => node.textContent?.startsWith(SESSION_EXPIRED));
    expect(notice).toBeDefined();
    expect(document.activeElement).toBe(notice);
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByLabelText('撰写回帖')).not.toBeInTheDocument();
    expect(screen.queryByText('登录后即可回帖')).not.toBeInTheDocument();
    expect(storedJson(REPLY_KEY)).toMatchObject({ v: 1, userId: 'u1', body: '打到一半' });
  });

  it('§6-6: focus elsewhere is not moved by the notice', () => {
    renderAt('/forum/test-topic');
    const heading = screen.getByRole('heading', { level: 1 });
    heading.focus();
    act(() => noteTrpcQueryFailure(rejected('auth.me')));
    expect(document.activeElement).toBe(heading);
  });
});

function firstFormFrame(): Frame | undefined {
  return frames.find(
    (frame) =>
      !frame.skeleton && (frame.title !== null || frame.reply !== null || frame.notAllowed),
  );
}

function describedByIds(node: HTMLElement): string[] {
  return (node.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
}

describe('§7-10 v1.3: the first frame is already the final state', () => {
  /** The topic was fetched 6 minutes ago (still in the cache); its window closed 1 minute ago. */
  function cachedExpiredTopic() {
    const fetchedAt = Date.now() - 6 * 60_000;
    topic.current = {
      ...topic.current,
      editableUntil: new Date(fetchedAt + 5 * 60_000).toISOString(),
      serverNow: new Date(fetchedAt).toISOString(),
    };
    topicMeta.dataUpdatedAt = fetchedAt;
  }

  /** Cold load: fetched just now, window closed 1 minute ago. */
  function freshExpiredTopic() {
    topic.current = {
      ...topic.current,
      editableUntil: new Date(Date.now() - 60_000).toISOString(),
      serverNow: new Date().toISOString(),
    };
    topicMeta.dataUpdatedAt = Date.now();
  }

  it('26-11 (a): cached topic past its window → every frame is expired, never a countdown or an enabled Save', () => {
    cachedExpiredTopic();
    storeDraft(EDIT_KEY, { userId: 'u1', title: 'Draft title', body: 'Draft body' });
    renderAt('/forum/test-topic/edit');

    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.countdown).toBe(false);
      expect(frame.saveEnabled).not.toBe(true);
    }
    expect(firstFormFrame()).toMatchObject({ expiredAlert: true, title: 'Draft title' });
  });

  it('26-11 (a): a cached topic still inside its window shows the real time left, not the time at fetch', () => {
    const fetchedAt = Date.now() - 3 * 60_000;
    topic.current = {
      ...topic.current,
      editableUntil: new Date(fetchedAt + 5 * 60_000).toISOString(),
      serverNow: new Date(fetchedAt).toISOString(),
    };
    topicMeta.dataUpdatedAt = fetchedAt;
    renderAt('/forum/test-topic/edit');
    expect(screen.getByText('还可编辑 2 分钟')).toBeInTheDocument();
  });

  it('26-12 (b): cold load past the window with a valid draft → no frame ever shows notAllowed', () => {
    freshExpiredTopic();
    storeDraft(EDIT_KEY, { userId: 'u1', title: 'Draft title', body: 'Draft body' });
    renderAt('/forum/test-topic/edit');

    expect(frames.some((frame) => frame.notAllowed)).toBe(false);
    expect(firstFormFrame()).toMatchObject({
      expiredAlert: true,
      title: 'Draft title',
      body: 'Draft body',
      saveEnabled: false,
    });
    expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull();
  });

  it('26-12 (b): with no valid draft, notAllowed is the first and only state', () => {
    freshExpiredTopic();
    renderAt('/forum/test-topic/edit');
    expect(firstFormFrame()).toMatchObject({ notAllowed: true, title: null });
    expect(frames.some((frame) => frame.title !== null)).toBe(false);
  });

  it('26-13 (c): /forum/new shows the draft in the first frame, never an empty form', () => {
    storeDraft(NEW_KEY, { userId: 'u1', title: 'New draft', body: 'New body' });
    renderAt('/forum/new');
    expect(firstFormFrame()).toMatchObject({ title: 'New draft', body: 'New body' });
    expect(frames.some((frame) => frame.title === '')).toBe(false);
  });

  it('26-13 (c): edit inside the window shows the draft in the first frame, never the topic text', () => {
    storeDraft(EDIT_KEY, { userId: 'u1', title: 'Edited title', body: 'Edited body' });
    renderAt('/forum/test-topic/edit');
    expect(firstFormFrame()).toMatchObject({ title: 'Edited title', body: 'Edited body' });
    expect(frames.some((frame) => frame.title === 'Original title')).toBe(false);
    expect(screen.getByRole('button', { name: '保存修改' })).toBeEnabled();
  });

  it('26-13 (c): the reply box shows the draft in the first frame, never empty', () => {
    storeDraft(REPLY_KEY, { userId: 'u1', body: '我的回帖' });
    renderAt('/forum/test-topic');
    const withReply = frames.filter((frame) => frame.reply !== null);
    expect(withReply[0]?.reply).toBe('我的回帖');
    expect(withReply.some((frame) => frame.reply === '')).toBe(false);
  });

  it('§7-8: focus still moves to the restored field after the text is in', () => {
    storeDraft(NEW_KEY, { userId: 'u1', title: 'New draft', body: 'New body' });
    renderAt('/forum/new');
    expect(document.activeElement).toBe(screen.getByLabelText('标题'));
    expect(restoredLine()).toBeDefined();
  });
});

describe('§7-8 v1.4 / 26-14: every restored field is described by the restored line', () => {
  function expectDescribedByRestored(field: HTMLElement) {
    const line = restoredLine();
    expect(line).toBeDefined();
    expect(line?.id).toBeTruthy();
    expect(describedByIds(field)).toContain(line?.id);
  }

  it('/forum/new: title and body both point at the restored line', () => {
    storeDraft(NEW_KEY, { userId: 'u1', title: 'New draft', body: 'New body' });
    renderAt('/forum/new');
    expectDescribedByRestored(screen.getByLabelText('标题'));
    expectDescribedByRestored(screen.getByLabelText('正文'));
    expect(screen.getByLabelText('正文')).toHaveAccessibleDescription(RESTORED);
  });

  it('edit: title and body both point at the restored line', () => {
    storeDraft(EDIT_KEY, { userId: 'u1', title: 'Edited title', body: 'Edited body' });
    renderAt('/forum/test-topic/edit');
    expectDescribedByRestored(screen.getByLabelText('标题'));
    expectDescribedByRestored(screen.getByLabelText('正文'));
  });

  it('reply: the reply box points at the restored line', () => {
    storeDraft(REPLY_KEY, { userId: 'u1', body: '我的回帖' });
    renderAt('/forum/test-topic');
    expectDescribedByRestored(screen.getByLabelText('撰写回帖'));
  });

  it('the id goes away with the line after the first edit', async () => {
    const user = userEvent.setup();
    storeDraft(NEW_KEY, { userId: 'u1', title: 'New draft', body: 'New body' });
    renderAt('/forum/new');
    await user.type(screen.getByLabelText('正文'), '!');
    expect(screen.getByLabelText('标题')).not.toHaveAttribute('aria-describedby');
    expect(screen.getByLabelText('正文')).not.toHaveAttribute('aria-describedby');
  });
});
