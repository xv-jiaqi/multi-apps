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
  trpc: {
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
