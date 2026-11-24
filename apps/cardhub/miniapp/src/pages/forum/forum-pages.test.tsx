// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/components', () => import('../../test-stubs/taro-dom'));

const lifecycle = vi.hoisted(() => ({
  didShow: undefined as undefined | (() => void),
  pullDown: undefined as undefined | (() => void),
  slug: 'topic-1',
}));

const taro = vi.hoisted(() => ({
  showToast: vi.fn(async () => undefined),
  setNavigationBarTitle: vi.fn(async () => undefined),
  navigateTo: vi.fn(async () => undefined),
  redirectTo: vi.fn(async () => undefined),
  switchTab: vi.fn(async () => undefined),
  navigateBack: vi.fn(async () => undefined),
  getCurrentPages: vi.fn(() => [{}, {}]),
  stopPullDownRefresh: vi.fn(async () => undefined),
  pxTransform: (size: number) => `${size}px`,
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
  getEnv: () => 'WEB',
  ENV_TYPE: { WEB: 'WEB', WEAPP: 'WEAPP' },
}));

vi.mock('@tarojs/taro', () => ({
  default: taro,
  ...taro,
  useDidHide: () => undefined,
  useDidShow: (fn: () => void) => {
    lifecycle.didShow = fn;
  },
  usePullDownRefresh: (fn: () => void) => {
    lifecycle.pullDown = fn;
  },
  useRouter: () => ({ params: { slug: lifecycle.slug } }),
}));

const api = vi.hoisted(() => ({
  listTopics: vi.fn(),
  topicBySlug: vi.fn(),
  listReplies: vi.fn(),
  createReply: vi.fn(),
  createTopic: vi.fn(),
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    forum: {
      topics: {
        list: { query: api.listTopics },
        bySlug: { query: api.topicBySlug },
        create: { mutate: api.createTopic },
      },
      replies: {
        list: { query: api.listReplies },
        create: { mutate: api.createReply },
      },
    },
  },
}));

const stores = vi.hoisted(() => ({
  locale: { locale: 'zh-CN' as const },
  session: {
    token: 'session-token',
    isAuthenticated: true,
    user: { id: 'alice', username: 'alice' } as { id: string; username: string } | null,
  },
}));

vi.mock('../../stores/root-store', () => ({ useStores: () => stores }));
vi.mock('../../lib/apply-tab-bar-labels', () => ({ applyTabBarLabels: vi.fn() }));

import ForumListPage from './list/index';
import ForumDetailPage from './detail/index';
import ForumNewPage from './new/index';
import { markListNeedsRefresh, resetListRefreshFlags } from '../../lib/list-refresh';
import { forgetAllListSessions } from '../../lib/list-session';
import { resetQueuedStatusToast } from '../../lib/status-toast';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function topic(i: number, status: 'pass' | 'review' | 'blocked' = 'pass') {
  return {
    id: `t${i}`,
    slug: `topic-${i}`,
    title: `话题 ${i}`,
    excerpt: `摘要 ${i}`,
    pinned: false,
    editedAt: null,
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-20T08:00:00.000Z',
    author: { id: 'u2', username: 'bob' },
    replyCount: 1,
    safetyStatus: status,
  };
}

function reply(i: number) {
  return {
    id: `r${i}`,
    body: `回帖 ${i}`,
    createdAt: '2026-11-21T08:00:00.000Z',
    author: { id: 'u2', username: 'bob' },
    safetyStatus: 'pass' as const,
  };
}

function detail(partial: Record<string, unknown> = {}) {
  return {
    ...topic(1),
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'topic-1',
    body: '正文第一行\n第二行',
    editableUntil: '2026-11-20T08:15:00.000Z',
    serverNow: '2026-11-25T00:00:00.000Z',
    replies: Array.from({ length: 20 }, (_, i) => reply(i)),
    replyNextCursor: 'r19',
    ...partial,
  };
}

async function showList() {
  const view = render(<ForumListPage />);
  await act(async () => {
    lifecycle.didShow?.();
  });
  return view;
}

afterEach(() => {
  cleanup();
  lifecycle.didShow = undefined;
  lifecycle.slug = 'topic-1';
  stores.session.isAuthenticated = true;
  stores.session.user = { id: 'alice', username: 'alice' };
  stores.session.token = 'session-token';
});

beforeEach(() => {
  stores.session.isAuthenticated = true;
  stores.session.user = { id: 'alice', username: 'alice' };
  stores.session.token = 'session-token';
  api.listTopics.mockReset();
  api.topicBySlug.mockReset();
  api.listReplies.mockReset();
  api.createReply.mockReset();
  api.createTopic.mockReset();
  taro.showToast.mockReset();
  taro.redirectTo.mockReset();
  taro.navigateTo.mockReset();
  taro.navigateBack.mockReset();
  taro.switchTab.mockReset();
  taro.getCurrentPages.mockReturnValue([{}, {}] as never);
  resetListRefreshFlags();
  forgetAllListSessions();
  resetQueuedStatusToast();
});

describe('forum list load more and refresh', () => {
  it('same-tick load-more clicks send one request and do not duplicate topics', async () => {
    const first = deferred<{ items: ReturnType<typeof topic>[]; nextCursor: string | null }>();
    const second = deferred<{ items: ReturnType<typeof topic>[]; nextCursor: string | null }>();
    api.listTopics
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    await showList();
    await act(async () => {
      first.resolve({
        items: Array.from({ length: 20 }, (_, i) => topic(i)),
        nextCursor: 'c20',
      });
      await first.promise;
    });

    const button = await screen.findByRole('button', { name: '加载更多' });
    act(() => {
      button.click();
      button.click();
      button.click();
      button.click();
      button.click();
    });
    expect(api.listTopics.mock.calls.filter((call) => call[0]?.cursor === 'c20')).toHaveLength(1);

    await act(async () => {
      second.resolve({
        items: [topic(20), topic(21), topic(22)],
        nextCursor: null,
      });
      await second.promise;
    });

    const titles = screen.getAllByText(/话题 \d+/).map((el) => el.textContent);
    expect(titles).toHaveLength(23);
    expect(new Set(titles).size).toBe(23);
  });

  it('does not append a stale page after a submit-driven reload while load-more is in flight', async () => {
    const first = deferred<{ items: ReturnType<typeof topic>[]; nextCursor: string | null }>();
    const stale = deferred<{ items: ReturnType<typeof topic>[]; nextCursor: string | null }>();
    const fresh = deferred<{ items: ReturnType<typeof topic>[]; nextCursor: string | null }>();
    api.listTopics
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise);

    await showList();
    await act(async () => {
      first.resolve({
        items: Array.from({ length: 20 }, (_, i) => topic(i)),
        nextCursor: 'c20',
      });
      await first.promise;
    });

    const button = await screen.findByRole('button', { name: '加载更多' });
    act(() => {
      button.click();
    });
    expect(api.listTopics).toHaveBeenCalledTimes(2);

    markListNeedsRefresh('forum');
    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(api.listTopics).toHaveBeenCalledTimes(3);

    await act(async () => {
      stale.resolve({
        items: [topic(20), topic(21), topic(22)],
        nextCursor: null,
      });
      await stale.promise;
    });
    await act(async () => {
      fresh.resolve({
        items: Array.from({ length: 20 }, (_, i) => topic(i + 100)),
        nextCursor: 'fresh-c20',
      });
      await fresh.promise;
    });

    const titles = screen.getAllByText(/话题 \d+/).map((el) => el.textContent);
    expect(titles).toEqual(Array.from({ length: 20 }, (_, i) => `话题 ${i + 100}`));
    expect(titles).not.toContain('话题 20');
  });

  it('reloads the first page with a fresh request when shown again after a submit while the first load is still running', async () => {
    const hanging = deferred<{ items: ReturnType<typeof topic>[]; nextCursor: string | null }>();
    const fresh = deferred<{ items: ReturnType<typeof topic>[]; nextCursor: string | null }>();
    api.listTopics
      .mockImplementationOnce(() => hanging.promise)
      .mockImplementationOnce(() => fresh.promise);

    await showList();
    expect(api.listTopics).toHaveBeenCalledTimes(1);

    markListNeedsRefresh('forum');
    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(api.listTopics).toHaveBeenCalledTimes(2);
    expect(api.listTopics.mock.calls.every((call) => !call[0]?.cursor)).toBe(true);

    await act(async () => {
      hanging.resolve({ items: [topic(1)], nextCursor: null });
      await hanging.promise;
    });
    await act(async () => {
      fresh.resolve({ items: [topic(2)], nextCursor: null });
      await fresh.promise;
    });
    expect(screen.getByText('话题 2')).toBeTruthy();
    expect(screen.queryByText('话题 1')).toBeNull();
  });
});

describe('forum detail reply refresh and breadcrumbs', () => {
  it('reloads the topic with a fresh request after posting a reply', async () => {
    const initial = deferred<ReturnType<typeof detail>>();
    const refreshed = deferred<ReturnType<typeof detail>>();
    api.topicBySlug
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => refreshed.promise);
    api.createReply.mockResolvedValue({ id: 'r-new', safetyStatus: 'pass' });

    render(<ForumDetailPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    await act(async () => {
      initial.resolve(detail());
      await initial.promise;
    });

    const input = screen.getByPlaceholderText('说点什么…');
    fireEvent.change(input, { target: { value: '这是一条回帖内容' } });
    const submit = document.querySelector('button.primary-button') as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    await waitFor(() => expect(api.createReply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.topicBySlug).toHaveBeenCalledTimes(2));

    await act(async () => {
      refreshed.resolve(
        detail({
          replies: [...Array.from({ length: 20 }, (_, i) => reply(i)), reply(20)],
          replyNextCursor: 'r20',
          replyCount: 21,
        }),
      );
      await refreshed.promise;
    });
    expect(screen.getByText('回帖 20')).toBeTruthy();
  });

  it('keeps the topic and shows a status toast when the reply is saved but the refresh fails', async () => {
    api.topicBySlug
      .mockResolvedValueOnce(detail())
      .mockRejectedValueOnce(new Error('refresh failed'));
    api.createReply.mockResolvedValue({ id: 'r-new', safetyStatus: 'pass' });

    render(<ForumDetailPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    await screen.findByText('话题 1');

    const input = screen.getByPlaceholderText('说点什么…');
    fireEvent.change(input, { target: { value: '这是一条回帖内容' } });
    const submit = document.querySelector('button.primary-button') as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('已发出，列表暂未更新'),
    );
    expect(screen.getByText('话题 1')).toBeTruthy();
    expect(screen.queryByText('话题加载失败')).toBeNull();
    expect((screen.getByPlaceholderText('说点什么…') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows only two breadcrumb levels while loading, on failure, and for a blocked topic', async () => {
    const hanging = deferred<ReturnType<typeof detail>>();
    api.topicBySlug.mockImplementation(() => hanging.promise);
    const loading = render(<ForumDetailPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(loading.container.textContent).toContain('社区论坛');
    expect(loading.container.textContent).not.toContain('话题 1');
    const loadingCrumbs = Array.from(loading.container.querySelectorAll('span'))
      .map((el) => el.textContent)
      .join('');
    expect(loadingCrumbs).not.toContain(' / 话题 1');
    loading.unmount();
    api.topicBySlug.mockReset();

    api.topicBySlug.mockRejectedValueOnce(
      Object.assign(new Error('no'), { data: { httpStatus: 500 } }),
    );
    const failed = render(<ForumDetailPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    await waitFor(() => expect(failed.container.textContent).toContain('话题加载失败'));
    const failedText = failed.container.textContent ?? '';
    expect(failedText).toContain('社区论坛');
    expect(failedText.match(/社区论坛/g)?.length).toBe(1);
    expect(failedText).not.toContain('话题 1');
    failed.unmount();

    api.topicBySlug.mockResolvedValueOnce(
      detail({ safetyStatus: 'blocked', title: '', body: '', replies: [], replyNextCursor: null }),
    );
    const blocked = render(<ForumDetailPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    await waitFor(() => expect(blocked.container.textContent).toContain('没有发布'));
    const blockedText = blocked.container.textContent ?? '';
    expect(blockedText).toContain('社区论坛');
    expect(blockedText).not.toMatch(/社区论坛[\s\S]*社区论坛/);
    blocked.unmount();
  });
});

describe('forum new login redirect', () => {
  it('redirects to login only once when opened while signed out', async () => {
    stores.session.isAuthenticated = false;
    render(<ForumNewPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(taro.redirectTo).toHaveBeenCalledTimes(1);
    expect(taro.redirectTo).toHaveBeenCalledWith({ url: '/pages/auth/login/index' });
    expect(taro.navigateTo).not.toHaveBeenCalled();

    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(taro.redirectTo).toHaveBeenCalledTimes(1);
  });
});

describe('forum write safety and list return (CH-301 v1.5)', () => {
  it('does not reload the first page when returning to the list without a new post', async () => {
    const first = deferred<{ items: ReturnType<typeof topic>[]; nextCursor: string | null }>();
    api.listTopics.mockImplementationOnce(() => first.promise);

    await showList();
    await act(async () => {
      first.resolve({ items: [topic(1), topic(2)], nextCursor: null });
      await first.promise;
    });
    expect(api.listTopics).toHaveBeenCalledTimes(1);

    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(api.listTopics).toHaveBeenCalledTimes(1);
    expect(screen.getByText('话题 1')).toBeTruthy();
  });

  it('reloads the first page after a successful submit when the list is shown again', async () => {
    const first = deferred<{ items: ReturnType<typeof topic>[]; nextCursor: string | null }>();
    const fresh = deferred<{ items: ReturnType<typeof topic>[]; nextCursor: string | null }>();
    api.listTopics
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => fresh.promise);

    await showList();
    await act(async () => {
      first.resolve({ items: [topic(1)], nextCursor: null });
      await first.promise;
    });
    expect(api.listTopics).toHaveBeenCalledTimes(1);

    markListNeedsRefresh('forum');
    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(api.listTopics).toHaveBeenCalledTimes(2);
    expect(api.listTopics.mock.calls[1]?.[0]?.cursor).toBeUndefined();

    await act(async () => {
      fresh.resolve({ items: [topic(9)], nextCursor: null });
      await fresh.promise;
    });
    expect(screen.getByText('话题 9')).toBeTruthy();
    expect(screen.queryByText('话题 1')).toBeNull();
  });

  it('does not jump to the topic and leaves the compose page when create returns unchecked', async () => {
    api.createTopic.mockResolvedValue({ slug: 'new-topic', safetyStatus: 'unchecked' });
    render(<ForumNewPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    fireEvent.change(screen.getByPlaceholderText('一句话概括你想讨论的内容'), {
      target: { value: '新话题标题' },
    });
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '新话题正文内容' } });
    const submit = document.querySelector('button.primary-button') as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    await waitFor(() => expect(api.createTopic).toHaveBeenCalledTimes(1));
    expect(taro.redirectTo).not.toHaveBeenCalled();
    expect(taro.navigateBack).toHaveBeenCalledWith({ delta: 1 });
  });

  it('redirects to the topic when create returns pass', async () => {
    api.createTopic.mockResolvedValue({ slug: 'new-topic', safetyStatus: 'pass' });
    render(<ForumNewPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    fireEvent.change(screen.getByPlaceholderText('一句话概括你想讨论的内容'), {
      target: { value: '新话题标题' },
    });
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '新话题正文内容' } });
    const submit = document.querySelector('button.primary-button') as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    await waitFor(() => expect(api.createTopic).toHaveBeenCalledTimes(1));
    expect(taro.redirectTo).toHaveBeenCalledWith({
      url: '/pages/forum/detail/index?slug=new-topic',
    });
  });

  it('clears the reply box and does not refresh when the reply is not public', async () => {
    api.topicBySlug.mockResolvedValueOnce(detail());
    api.createReply.mockResolvedValue({ id: 'r-new', safetyStatus: 'unchecked' });

    render(<ForumDetailPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    await screen.findByText('话题 1');

    const input = screen.getByPlaceholderText('说点什么…');
    fireEvent.change(input, { target: { value: '这是一条回帖内容' } });
    const submit = document.querySelector('button.primary-button') as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    await waitFor(() => expect(api.createReply).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('已提交，审核通过后显示'),
    );
    expect(api.topicBySlug).toHaveBeenCalledTimes(1);
    expect((screen.getByPlaceholderText('说点什么…') as HTMLTextAreaElement).value).toBe('');
  });
});

describe('forum compose accessibility and list session', () => {
  it('associates the body textarea with the visible 正文 label', async () => {
    render(<ForumNewPage />);
    const textarea = document.querySelector('textarea');
    expect(textarea).not.toBeNull();
    const byId = document.getElementById('forum-new-body-label');
    expect(byId?.textContent).toContain('正文');
    expect(
      textarea?.getAttribute('aria-labelledby') === 'forum-new-body-label' ||
        textarea?.getAttribute('aria-label') === '正文',
    ).toBe(true);
  });

  it('keeps loaded topics after the list remounts and does not fetch again', async () => {
    api.listTopics.mockResolvedValue({
      items: Array.from({ length: 5 }, (_, i) => topic(i)),
      nextCursor: 'c5',
    });
    const first = await showList();
    await screen.findByText('话题 4');
    expect(api.listTopics).toHaveBeenCalledTimes(1);
    first.unmount();
    await showList();
    await screen.findByText('话题 4');
    expect(api.listTopics).toHaveBeenCalledTimes(1);
  });
});

describe('forum list account switch', () => {
  it("does not reuse the previous user's pending topics after an account switch", async () => {
    api.listTopics.mockResolvedValueOnce({
      items: [topic(1, 'review')],
      nextCursor: null,
    });
    const first = await showList();
    await screen.findByText('话题 1');
    expect(screen.getByText('审核中')).toBeTruthy();
    expect(api.listTopics).toHaveBeenCalledTimes(1);
    first.unmount();

    stores.session.user = { id: 'bob', username: 'bob' };
    api.listTopics.mockResolvedValueOnce({
      items: [topic(8)],
      nextCursor: null,
    });
    await showList();
    await screen.findByText('话题 8');
    expect(screen.queryByText('话题 1')).toBeNull();
    expect(api.listTopics).toHaveBeenCalledTimes(2);
  });

  it('refetches and drops the cached list after sign-out', async () => {
    api.listTopics.mockResolvedValueOnce({
      items: [topic(1, 'review')],
      nextCursor: null,
    });
    const first = await showList();
    await screen.findByText('话题 1');
    first.unmount();

    stores.session.isAuthenticated = false;
    stores.session.user = null;
    api.listTopics.mockResolvedValueOnce({
      items: [topic(3)],
      nextCursor: null,
    });
    await showList();
    await screen.findByText('话题 3');
    expect(screen.queryByText('话题 1')).toBeNull();
    expect(api.listTopics).toHaveBeenCalledTimes(2);
  });
});

describe('forum compose submit lock and reply label', () => {
  async function fillAndSubmitTopic() {
    render(<ForumNewPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    fireEvent.change(screen.getByPlaceholderText('一句话概括你想讨论的内容'), {
      target: { value: '新话题标题' },
    });
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '新话题正文内容' } });
    const submit = document.querySelector('button.primary-button') as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    return submit;
  }

  it('keeps the compose button locked after a successful unchecked create so a second click does not post again', async () => {
    api.createTopic.mockResolvedValue({ slug: 'new-topic', safetyStatus: 'unchecked' });
    const submit = await fillAndSubmitTopic();
    await waitFor(() => expect(api.createTopic).toHaveBeenCalledTimes(1));
    expect(submit.disabled || submit.getAttribute('aria-disabled') === 'true').toBe(true);
    await act(async () => {
      submit.click();
    });
    expect(api.createTopic).toHaveBeenCalledTimes(1);
  });

  it('keeps the compose button locked after a successful pass create', async () => {
    api.createTopic.mockResolvedValue({ slug: 'new-topic', safetyStatus: 'pass' });
    const submit = await fillAndSubmitTopic();
    await waitFor(() => expect(api.createTopic).toHaveBeenCalledTimes(1));
    expect(submit.disabled || submit.getAttribute('aria-disabled') === 'true').toBe(true);
    await act(async () => {
      submit.click();
    });
    expect(api.createTopic).toHaveBeenCalledTimes(1);
  });

  it('associates the reply textarea with the visible reply label', async () => {
    api.topicBySlug.mockResolvedValueOnce(detail());
    render(<ForumDetailPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    await screen.findByText('话题 1');
    const label = document.getElementById('forum-detail-reply-label');
    expect(label?.textContent).toMatch(/回复|回帖|Reply/i);
    const textarea = screen.getByPlaceholderText('说点什么…');
    expect(
      textarea.getAttribute('aria-labelledby') === 'forum-detail-reply-label' ||
        Boolean(textarea.getAttribute('aria-label')),
    ).toBe(true);
  });
});
