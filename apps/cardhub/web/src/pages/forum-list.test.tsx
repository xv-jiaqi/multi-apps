import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';

const fetchNextPage = vi.fn();
const refetch = vi.fn();

type TopicFixture = {
  id: string;
  slug: string;
  title: string;
  body: string;
  excerpt: string;
  pinned: boolean;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: { id: string; username: string };
  replyCount: number;
};

const queryState = {
  items: [] as TopicFixture[],
  isLoading: false,
  isError: false,
  error: { message: 'private database details' },
  hasNextPage: false,
  isFetchingNextPage: false,
};

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
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
        list: {
          useInfiniteQuery: () => ({
            data: { pages: [{ items: queryState.items, nextCursor: null }] },
            isLoading: queryState.isLoading,
            isError: queryState.isError,
            error: queryState.error,
            hasNextPage: queryState.hasNextPage,
            isFetchingNextPage: queryState.isFetchingNextPage,
            refetch,
            fetchNextPage,
          }),
        },
      },
    },
  },
}));

import { ForumListPage } from './forum-list';
import { act } from '@testing-library/react';
import { APP_ERROR_CODES } from '@repo/shared';
import { SessionExpiryWatcher } from '../components/session-expiry-watcher';
import { noteTrpcQueryFailure } from '../lib/session-expiry';
import { resetSessionExpiryRedirectForTests } from '../lib/session-expiry-redirect';
import { resetForumSessionNoticeForTests } from '../lib/forum-session-notice';

function makeTopic(overrides: Partial<TopicFixture> = {}): TopicFixture {
  return {
    id: overrides.id ?? 'topic-1',
    slug: overrides.slug ?? 'topic-1',
    title: overrides.title ?? 'Topic title',
    body: overrides.body ?? '# Markdown body',
    excerpt: overrides.excerpt ?? 'Plain excerpt',
    pinned: overrides.pinned ?? false,
    editedAt: overrides.editedAt ?? null,
    createdAt: overrides.createdAt ?? '2026-05-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-01T00:00:00.000Z',
    author: overrides.author ?? { id: 'u1', username: 'alice' },
    replyCount: overrides.replyCount ?? 0,
  };
}

function LocationStateProbe() {
  const location = useLocation();
  return (
    <output role="none" aria-label="location-state">
      {JSON.stringify(location.state)}
    </output>
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ForumListPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.session.signOut();
  queryState.items = [];
  queryState.isLoading = false;
  queryState.isError = false;
  queryState.hasNextPage = false;
  queryState.isFetchingNextPage = false;
  fetchNextPage.mockReset();
  refetch.mockReset();
});

describe('ForumListPage topic deletion notice', () => {
  it('shows a focused status notice and clears router state', async () => {
    rootStore.session.signOut();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/forum', state: { notice: 'topicDeleted' } }]}>
        <Routes>
          <Route
            path="/forum"
            element={
              <>
                <ForumListPage />
                <LocationStateProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const notice = await screen.findByText('话题已删除');
    expect(notice).toHaveTextContent('话题已删除');
    expect(notice).toHaveFocus();

    await waitFor(() => {
      expect(screen.getByLabelText('location-state')).toHaveTextContent('null');
    });
  });
});

describe('ForumListPage CH-103 rendering', () => {
  it('renders pinned badge and the server-provided excerpt', () => {
    queryState.items = [
      makeTopic({ pinned: true, excerpt: 'Plain text from API', body: '# **Raw markdown**' }),
    ];

    renderPage();

    expect(screen.getByText('置顶')).toBeInTheDocument();
    expect(screen.getByText('Plain text from API')).toBeInTheDocument();
    expect(screen.queryByText('# **Raw markdown**')).not.toBeInTheDocument();
  });

  it('does not render an excerpt paragraph when excerpt is empty', () => {
    queryState.items = [makeTopic({ excerpt: '' })];

    renderPage();

    expect(screen.getByText('Topic title')).toBeInTheDocument();
    expect(screen.queryByText('Plain excerpt')).not.toBeInTheDocument();
  });

  it('does not leak the raw error message', () => {
    queryState.isError = true;

    renderPage();

    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.queryByText('private database details')).not.toBeInTheDocument();
  });

  it('checks fetchNextPage result.isError', async () => {
    queryState.items = [makeTopic()];
    queryState.hasNextPage = true;
    fetchNextPage.mockResolvedValueOnce({ isError: true });
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: '加载更多' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败');
  });
});

describe('ForumListPage CH-226', () => {
  function expireSilently() {
    act(() =>
      noteTrpcQueryFailure({
        data: { code: 'UNAUTHORIZED', appCode: APP_ERROR_CODES.UNAUTHORIZED, path: 'auth.me' },
      }),
    );
  }

  function renderWithWatcher(
    entry: { pathname: string; state?: unknown } = { pathname: '/forum' },
  ) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <SessionExpiryWatcher />
        <Routes>
          <Route path="/forum" element={<ForumListPage />} />
          <Route path="/login" element={<LocationStateProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    resetSessionExpiryRedirectForTests();
    resetForumSessionNoticeForTests();
    rootStore.locale.setLocale('zh-CN');
  });

  it('26-8: 登录发帖 sends state.from = /forum/new and has a 24px, focus-ringed hit area', async () => {
    const user = userEvent.setup();
    renderWithWatcher();
    const link = screen.getByRole('link', { name: '登录后发布话题' });
    expect(link).toHaveClass('inline-flex', 'min-h-6', 'items-center', 'text-link');
    expect(link).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-brand-500');
    await user.click(link);
    expect(screen.getByLabelText('location-state')).toHaveTextContent('{"from":"/forum/new"}');
  });

  it('§6-2: the session notice sits under the topicDeleted notice', () => {
    rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
    queryState.items = [makeTopic()];
    renderWithWatcher({ pathname: '/forum', state: { notice: 'topicDeleted' } });
    expireSilently();
    const deleted = screen.getByText('话题已删除');
    const expired = screen.getByText((_, node) =>
      Boolean(node?.matches('p[role="status"]') && node.textContent?.startsWith('登录已失效')),
    );
    expect(
      deleted.compareDocumentPosition(expired) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('Topic title')).toBeInTheDocument();
  });

  it.each([
    ['loading', () => (queryState.isLoading = true)],
    ['error', () => (queryState.isError = true)],
    ['empty', () => (queryState.items = [])],
  ])('§6-8: the notice also shows in the %s state, next to its own UI', (state, arrange) => {
    arrange();
    rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
    renderWithWatcher();
    expireSilently();
    expect(
      screen.getAllByRole('status').filter((node) => node.textContent?.startsWith('登录已失效')),
    ).toHaveLength(1);
    if (state === 'error') expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    if (state === 'empty') expect(screen.getByText('还没有话题，第一个开聊吧')).toBeInTheDocument();
  });
});
