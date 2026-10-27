import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';

const topicInvalidate = vi.fn();
const topicsListInvalidate = vi.fn();
const repliesInvalidate = vi.fn();
const createReplyMutate = vi.fn();
const deleteReplyMutate = vi.fn();
const deleteTopicMutate = vi.fn();
const setPinnedMutate = vi.fn();
let setPinnedIsPending = false;
const fetchNextPage = vi.fn();
const repliesReset = vi.fn();
const topicSetData = vi.fn();
const repliesSetInfiniteData = vi.fn();
const repliesQueryInputs: Array<{ topicId: string; limit: number }> = [];
let latestInitialCursor: string | undefined;

interface ReplyFixture {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; username: string };
}

function makeReply(index: number): ReplyFixture {
  return {
    id: `reply-${String(index).padStart(2, '0')}`,
    body: `Reply ${index}`,
    createdAt: `2026-05-01T00:${String(index).padStart(2, '0')}:00.000Z`,
    author: { id: `user-${index}`, username: `user${index}` },
  };
}

const replies = Array.from({ length: 45 }, (_, index) => makeReply(index + 1));
let availableReplies = replies;

const topicState: {
  isLoading: boolean;
  isError: boolean;
  error: { message: string; data?: { code?: string } } | null;
  data:
    | {
        id: string;
        slug: string;
        title: string;
        body: string;
        pinned: boolean;
        editedAt: string | null;
        createdAt: string;
        updatedAt: string;
        editableUntil: string;
        serverNow: string;
        author: { id: string; username: string };
        replyCount: number;
        replies: ReplyFixture[];
        replyNextCursor: string | null;
      }
    | undefined;
} = {
  isLoading: false,
  isError: false,
  error: null,
  data: undefined,
};

const repliesQueryState = {
  data: {
    pages: [] as Array<{ items: ReplyFixture[]; nextCursor: string | null }>,
    pageParams: [] as Array<string | undefined>,
  },
  cursor: undefined as string | undefined,
  hasNextPage: true,
  isFetchingNextPage: false,
  isLoading: false,
  isFetching: false,
  isSuccess: true,
  isFetchNextPageError: false,
};

function nextReplyPage(cursor: string | undefined) {
  const startIndex = cursor ? availableReplies.findIndex((reply) => reply.id === cursor) + 1 : 0;
  const safeStartIndex = startIndex > 0 ? startIndex : 0;
  const items = availableReplies.slice(safeStartIndex, safeStartIndex + 20);
  return {
    items,
    nextCursor: safeStartIndex + items.length < availableReplies.length ? items.at(-1)!.id : null,
  };
}

// React Query v5 refetches an infinite query with the cursors stored in
// `pageParams`, not the latest `initialCursor`. This mock replays that, so
// the cursor-delete test fails if `removeReplyFromCache` leaves a deleted id
// in `pageParams`.
function refetchLoadedReplyPages() {
  if (repliesQueryState.data.pageParams.length === 0) return;
  const pages = repliesQueryState.data.pageParams.map((pageParam) => nextReplyPage(pageParam));
  repliesQueryState.data = {
    pages,
    pageParams: repliesQueryState.data.pageParams,
  };
  repliesQueryState.hasNextPage = Boolean(pages.at(-1)?.nextCursor);
}

vi.mock('../lib/trpc', () => ({
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
        bySlug: {
          useQuery: () => topicState,
        },
        delete: {
          useMutation: (handlers: {
            onSuccess?: () => void | Promise<void>;
            onError?: (error: { data?: { code?: string } }) => void | Promise<void>;
          }) => ({
            mutate: (input: unknown) => deleteTopicMutate(input, handlers),
            isPending: false,
          }),
        },
        setPinned: {
          useMutation: ({
            onSuccess,
            onError,
          }: {
            onSuccess?: (topic: { pinned: boolean }) => void | Promise<void>;
            onError?: (error: { data?: { code?: string } }) => void;
          }) => ({
            mutate: (input: unknown) => setPinnedMutate(input, { onSuccess, onError }),
            isPending: setPinnedIsPending,
          }),
        },
        list: {
          invalidate: vi.fn(),
        },
      },
      replies: {
        list: {
          useInfiniteQuery: (
            input: { topicId: string; limit: number },
            options: { initialCursor?: string },
          ) => {
            repliesQueryInputs.push(input);
            latestInitialCursor = options.initialCursor;
            if (repliesQueryState.data.pages.length === 0) {
              repliesQueryState.cursor = options.initialCursor;
            }
            return {
              ...repliesQueryState,
              fetchNextPage,
            };
          },
        },
        create: {
          useMutation: ({
            onSuccess,
            onError,
          }: {
            onSuccess?: (reply: ReplyFixture) => void | Promise<void>;
            onError?: (error: {
              message?: string;
              data?: { code?: string; appCode?: string };
            }) => void;
          }) => ({
            mutate: (input: unknown) => createReplyMutate(input, { onSuccess, onError }),
            isPending: false,
          }),
        },
        delete: {
          useMutation: ({
            onSuccess,
            onError,
          }: {
            onSuccess?: (data: { ok: boolean }, variables: { id: string }) => void;
            onError?: (error: { data?: { code?: string } }, variables: { id: string }) => void;
          }) => ({
            mutate: (input: { id: string }) => deleteReplyMutate(input, { onSuccess, onError }),
          }),
        },
      },
    },
    reports: {
      create: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      forum: {
        topics: {
          bySlug: {
            invalidate: topicInvalidate,
            setData: topicSetData,
          },
          list: { invalidate: topicsListInvalidate },
        },
        replies: {
          list: {
            invalidate: repliesInvalidate,
            reset: repliesReset,
            setInfiniteData: repliesSetInfiniteData,
          },
        },
      },
    }),
  },
}));

import { ForumDetailPage } from './forum-detail';

function ForumLanding() {
  const location = useLocation();
  return (
    <div>forum notice: {(location.state as { notice?: string } | null)?.notice ?? 'none'}</div>
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forum/test-topic']}>
      <Routes>
        <Route path="/forum/:slug" element={<ForumDetailPage />} />
        <Route path="/forum" element={<ForumLanding />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.session.signOut();
  topicInvalidate.mockClear();
  topicsListInvalidate.mockReset();
  topicsListInvalidate.mockResolvedValue(undefined);
  repliesInvalidate.mockReset();
  repliesInvalidate.mockImplementation(async () => {
    refetchLoadedReplyPages();
  });
  repliesReset.mockReset();
  repliesReset.mockImplementation(() => {
    repliesQueryState.cursor = latestInitialCursor;
    repliesQueryState.data = { pages: [], pageParams: [] };
    repliesQueryState.hasNextPage = Boolean(latestInitialCursor);
  });
  topicSetData.mockReset();
  topicSetData.mockImplementation((_input, updater) => {
    topicState.data = typeof updater === 'function' ? updater(topicState.data) : updater;
  });
  repliesSetInfiniteData.mockReset();
  repliesSetInfiniteData.mockImplementation((_input, updater) => {
    repliesQueryState.data =
      typeof updater === 'function' ? updater(repliesQueryState.data) : updater;
    repliesQueryState.hasNextPage = Boolean(repliesQueryState.data.pages.at(-1)?.nextCursor);
  });
  createReplyMutate.mockReset();
  createReplyMutate.mockImplementation((_input, handlers) => {
    const created = {
      id: 'reply-new',
      body: 'new reply',
      createdAt: '2026-05-01T00:50:00.000Z',
      author: { id: 'user-current', username: 'alice' },
    };
    availableReplies = [...availableReplies, created];
    return handlers.onSuccess?.(created);
  });
  deleteReplyMutate.mockReset();
  deleteReplyMutate.mockImplementation((input, handlers) => {
    availableReplies = availableReplies.filter((reply) => reply.id !== input.id);
    handlers.onSuccess?.({ ok: true }, input);
  });
  deleteTopicMutate.mockReset();
  deleteTopicMutate.mockImplementation((_input, handlers) => handlers.onSuccess?.());
  setPinnedMutate.mockReset();
  setPinnedIsPending = false;
  fetchNextPage.mockReset();
  repliesQueryInputs.length = 0;
  latestInitialCursor = undefined;
  availableReplies = replies;
  fetchNextPage.mockImplementation(async () => {
    const cursor = repliesQueryState.data.pages.at(-1)?.nextCursor ?? repliesQueryState.cursor;
    const page = nextReplyPage(cursor);
    repliesQueryState.data = {
      pages: [...repliesQueryState.data.pages, page],
      pageParams: [...repliesQueryState.data.pageParams, cursor],
    };
    repliesQueryState.hasNextPage = Boolean(page.nextCursor);
    return { data: repliesQueryState.data };
  });
  topicState.isLoading = false;
  topicState.isError = false;
  topicState.error = null;
  topicState.data = {
    id: '00000000-0000-0000-0000-000000000001',
    slug: 'test-topic',
    title: 'Test topic',
    body: 'Topic body',
    pinned: false,
    editedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    editableUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
    serverNow: new Date().toISOString(),
    author: { id: 'author-1', username: 'author' },
    replyCount: 45,
    replies: replies.slice(0, 20),
    replyNextCursor: replies[19]!.id,
  };
  repliesQueryState.cursor = undefined;
  repliesQueryState.data = { pages: [], pageParams: [] };
  repliesQueryState.hasNextPage = true;
  repliesQueryState.isFetchingNextPage = false;
  repliesQueryState.isLoading = false;
  repliesQueryState.isFetching = false;
  repliesQueryState.isSuccess = true;
  repliesQueryState.isFetchNextPageError = false;
});

describe('ForumDetailPage replies pagination', () => {
  it('renders the first 20 replies and loads 41 replies across two clicks', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText('Reply 1')).toBeInTheDocument();
    expect(screen.getByText('Reply 20')).toBeInTheDocument();
    expect(screen.queryByText('Reply 21')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));

    expect(await screen.findByText('Reply 21')).toBeInTheDocument();
    expect(screen.getByText('Reply 40')).toBeInTheDocument();
    expect(screen.queryByText('Reply 41')).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Reply \d+$/)).toHaveLength(40);

    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));

    expect(await screen.findByText('Reply 41')).toBeInTheDocument();
    expect(screen.getByText('已显示全部回帖')).toBeInTheDocument();
    expect(screen.getAllByText(/^Reply \d+$/)).toHaveLength(45);
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it('uses the refreshed inline cursor after deleting the previous cursor reply', async () => {
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));
    expect(await screen.findByText('Reply 30')).toBeInTheDocument();

    availableReplies = replies.filter((reply) => reply.id !== replies[19]!.id);
    topicState.data = {
      ...topicState.data!,
      replyCount: availableReplies.length,
      replies: availableReplies.slice(0, 20),
      replyNextCursor: availableReplies[19]!.id,
    };
    view.rerender(
      <MemoryRouter initialEntries={['/forum/test-topic']}>
        <Routes>
          <Route path="/forum/:slug" element={<ForumDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(latestInitialCursor).toBe('reply-21');
      expect(repliesReset).toHaveBeenCalled();
    });
    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));
    view.rerender(
      <MemoryRouter initialEntries={['/forum/test-topic']}>
        <Routes>
          <Route path="/forum/:slug" element={<ForumDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Reply 22')).toBeInTheDocument();
    expect(screen.getByText('Reply 30')).toBeInTheDocument();
    expect(screen.queryByText('Reply 20')).not.toBeInTheDocument();
  });

  it('keeps loaded reply pages expanded after deleting an inline non-cursor reply', async () => {
    rootStore.session.signIn('jwt.token', { id: 'user-5', username: 'user5' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));
    expect(await screen.findByText('Reply 21')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除 @user5 的回帖' }));
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(screen.queryByText('Reply 5')).not.toBeInTheDocument());
    expect(screen.getByText('Reply 21')).toBeInTheDocument();
    expect(screen.getByText('Reply 40')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '回帖（44）' })).toBeInTheDocument();
  });

  it('removes a deleted reply from an already loaded pagination page', async () => {
    rootStore.session.signIn('jwt.token', { id: 'admin-1', username: 'admin', role: 'admin' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));
    expect(await screen.findByText('Reply 25')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除 @user25 的回帖' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(screen.queryByText('Reply 25')).not.toBeInTheDocument());
    expect(screen.getByText('Reply 21')).toBeInTheDocument();
    expect(screen.getByText('Reply 40')).toBeInTheDocument();
    expect(screen.getByText('回帖已删除')).toHaveFocus();
  });

  it('can load more replies after deleting the current reply cursor', async () => {
    rootStore.session.signIn('jwt.token', { id: 'admin-1', username: 'admin', role: 'admin' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '删除 @user20 的回帖' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(screen.queryByText('Reply 20')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));

    expect(await screen.findByText('Reply 21')).toBeInTheDocument();
    expect(screen.getByText('Reply 40')).toBeInTheDocument();
  });

  it('keeps refetched pages after deleting the cursor reply and posting a reply', async () => {
    rootStore.session.signIn('jwt.token', { id: 'admin-1', username: 'admin', role: 'admin' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));
    expect(await screen.findByText('Reply 40')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除 @user20 的回帖' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(screen.queryByText('Reply 20')).not.toBeInTheDocument());
    expect(repliesQueryState.data.pageParams).toEqual(['reply-19']);

    await user.type(screen.getByLabelText('撰写回帖'), 'new reply');
    await user.click(screen.getByRole('button', { name: '发布回帖' }));

    await waitFor(() => {
      expect(fetchNextPage).toHaveBeenCalledTimes(2);
    });

    const cachedReplyIds = repliesQueryState.data.pages.flatMap((page) =>
      page.items.map((reply) => reply.id),
    );
    expect(cachedReplyIds).toEqual(
      expect.arrayContaining(['reply-21', 'reply-40', 'reply-45', 'reply-new']),
    );
    expect(new Set(cachedReplyIds).size).toBe(cachedReplyIds.length);
  });

  it('returns focus to the reply delete button on Escape and on delete failure', async () => {
    rootStore.session.signIn('jwt.token', { id: 'user-1', username: 'user1' });
    deleteReplyMutate.mockImplementation((input, handlers) => {
      handlers.onError?.({ data: { code: 'FORBIDDEN' } }, input);
    });
    const user = userEvent.setup();
    renderPage();

    const deleteButton = screen.getByRole('button', { name: '删除 @user1 的回帖' });
    await user.click(deleteButton);
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    expect(screen.queryByLabelText('删除原因（选填，只有管理员能看到）')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '删除 @user1 的回帖' })).toHaveFocus();
    });

    await user.click(screen.getByRole('button', { name: '删除 @user1 的回帖' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('你没有权限删除这条回帖');
    expect(screen.getByRole('button', { name: '删除 @user1 的回帖' })).toHaveFocus();
  });

  it('navigates to the forum list with a topicDeleted notice after deleting a topic', async () => {
    rootStore.session.signIn('jwt.token', { id: 'author-1', username: 'author' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '删除这个话题' }));
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(await screen.findByText('forum notice: topicDeleted')).toBeInTheDocument();
    expect(topicsListInvalidate).toHaveBeenCalled();
  });

  it('shows not-found copy without retry wording when a reply hits a deleted topic', async () => {
    rootStore.locale.setLocale('zh-CN');
    rootStore.session.signIn('jwt.token', { id: 'user-current', username: 'alice' });
    createReplyMutate.mockImplementation((_input, handlers) => {
      handlers.onError?.({
        message: '话题不存在',
        data: { code: 'NOT_FOUND' },
      });
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('撰写回帖'), 'reply to a deleted topic');
    await user.click(screen.getByRole('button', { name: '发布回帖' }));

    const notice = await screen.findByText('内容不存在或已被删除');
    expect(notice).not.toHaveTextContent('重试');
    expect(notice).not.toHaveTextContent('再试');
    expect(notice.textContent ?? '').not.toMatch(/retry|try again/i);
    expect(screen.queryByText('话题不存在')).not.toBeInTheDocument();
    expect(screen.queryByText('操作没有完成，请稍后再试')).not.toBeInTheDocument();
    expect(rootStore.session.token).toBe('jwt.token');
  });

  it('invalidates both topic detail and replies list after posting a reply', async () => {
    rootStore.session.signIn('jwt.token', { id: 'user-current', username: 'alice' });
    createReplyMutate.mockImplementation((_input, handlers) =>
      handlers.onSuccess?.({
        id: 'reply-new',
        body: 'new reply',
        createdAt: '2026-05-01T00:30:00.000Z',
        author: { id: 'user-current', username: 'alice' },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('撰写回帖'), 'new reply');
    await user.click(screen.getByRole('button', { name: '发布回帖' }));

    await waitFor(() => {
      expect(topicInvalidate).toHaveBeenCalledWith({ slug: 'test-topic' });
      expect(repliesInvalidate).toHaveBeenCalledWith({
        topicId: '00000000-0000-0000-0000-000000000001',
      });
    });
  });

  it('stops automatic post-create pagination after one failed fetch', async () => {
    rootStore.session.signIn('jwt.token', { id: 'user-current', username: 'alice' });
    createReplyMutate.mockImplementation((_input, handlers) =>
      handlers.onSuccess?.({
        id: 'reply-new',
        body: 'new reply',
        createdAt: '2026-05-01T00:30:00.000Z',
        author: { id: 'user-current', username: 'alice' },
      }),
    );
    fetchNextPage.mockImplementation(async () => {
      repliesQueryState.isFetchNextPageError = true;
      return { data: repliesQueryState.data, isError: true };
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('撰写回帖'), 'new reply');
    await user.click(screen.getByRole('button', { name: '发布回帖' }));

    await waitFor(() => {
      expect(fetchNextPage).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('回帖加载失败');
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('shows loading instead of the end message while the first hidden reply page loads', async () => {
    const user = userEvent.setup();
    fetchNextPage.mockImplementation(async () => {
      repliesQueryState.isLoading = true;
      repliesQueryState.isSuccess = false;
      return new Promise(() => undefined);
    });
    renderPage();

    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));

    const loadingButton = await screen.findByRole('button', { name: '加载中…' });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('已显示全部回帖')).not.toBeInTheDocument();
  });

  it('reuses load-more loading state while retrying failed reply pagination', async () => {
    const user = userEvent.setup();
    repliesQueryState.isFetchNextPageError = true;
    fetchNextPage.mockImplementation(async () => {
      repliesQueryState.isLoading = true;
      repliesQueryState.isSuccess = false;
      return new Promise(() => undefined);
    });
    renderPage();

    await user.click(screen.getByRole('button', { name: '重试' }));

    const loadingButton = await screen.findByRole('button', { name: '加载中…' });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('已显示全部回帖')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('visibly highlights a newly posted reply after it becomes visible', async () => {
    rootStore.session.signIn('jwt.token', { id: 'user-current', username: 'alice' });
    const newReply = {
      id: 'reply-new',
      body: 'new highlighted reply',
      createdAt: '2026-05-01T00:30:00.000Z',
      author: { id: 'user-current', username: 'alice' },
    };
    createReplyMutate.mockImplementation((_input, handlers) => handlers.onSuccess?.(newReply));
    repliesQueryState.hasNextPage = false;
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('撰写回帖'), 'new highlighted reply');
    topicState.data = {
      ...topicState.data!,
      replyCount: 46,
      replies: [...topicState.data!.replies, newReply],
      replyNextCursor: null,
    };
    await user.click(screen.getByRole('button', { name: '发布回帖' }));

    const highlightedReply = await screen.findByText('new highlighted reply');
    await waitFor(() => {
      expect(highlightedReply.closest('li')).toHaveClass('border-brand-200');
      expect(highlightedReply.closest('li')).toHaveClass('bg-brand-50');
      expect(highlightedReply.closest('li')).toHaveFocus();
    });
    const highlightedItem = highlightedReply.closest('li');
    expect(
      highlightedItem?.className.split(/\s+/).filter((name) => name.startsWith('duration-')),
    ).toEqual(['duration-0']);
    const restingItem = screen.getByText('Reply 1').closest('li');
    expect(
      restingItem?.className.split(/\s+/).filter((name) => name.startsWith('duration-')),
    ).toEqual(['duration-1000']);
  });

  it('drops a pending reply focus when the loaded row never mounts', async () => {
    const user = userEvent.setup();
    const view = renderPage();
    fetchNextPage.mockImplementation(async () => ({
      data: {
        pages: [{ items: [makeReply(21)], nextCursor: 'reply-21' }],
        pageParams: [topicState.data?.replyNextCursor],
      },
    }));

    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));
    expect(await screen.findByText('已加载 1 条回帖')).toBeInTheDocument();
    expect(screen.queryByText('Reply 21')).not.toBeInTheDocument();

    topicState.data = {
      ...topicState.data!,
      replies: [...topicState.data!.replies, makeReply(21)],
    };
    view.rerender(
      <MemoryRouter initialEntries={['/forum/test-topic']}>
        <Routes>
          <Route path="/forum/:slug" element={<ForumDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const lateReply = await screen.findByText('Reply 21');
    expect(lateReply.closest('li')).not.toHaveFocus();
  });

  it('moves focus to the first newly loaded reply when more pages remain', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));

    const firstNew = await screen.findByText('Reply 21');
    const item = firstNew.closest('li');
    expect(item).toHaveAttribute('tabindex', '-1');
    await waitFor(() => {
      expect(item).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('button', { name: '加载更多回帖' })).toBeInTheDocument();
  });
});

describe('ForumDetailPage CH-103 topic controls', () => {
  it('does not show edited marker for a pinned topic that was never edited', () => {
    topicState.data = {
      ...topicState.data!,
      pinned: true,
      editedAt: null,
      updatedAt: '2026-05-01T00:10:00.000Z',
    };

    renderPage();

    expect(screen.getByText('置顶')).toBeInTheDocument();
    expect(screen.queryByText('已编辑')).not.toBeInTheDocument();
  });

  it('shows edited marker only when editedAt is present', () => {
    topicState.data = {
      ...topicState.data!,
      editedAt: '2026-05-01T00:02:00.000Z',
    };

    renderPage();

    expect(
      screen.getByText((_, element) => element?.textContent?.includes('已编辑') ?? false, {
        selector: 'span',
      }),
    ).toBeInTheDocument();
  });

  it('uses serverNow correction when deciding whether the edit action is visible', () => {
    rootStore.session.signIn('jwt.token', { id: 'author-1', username: 'author' });
    const localNow = Date.now();
    topicState.data = {
      ...topicState.data!,
      editableUntil: new Date(localNow + 60_000).toISOString(),
      serverNow: new Date(localNow + 120_000).toISOString(),
    };

    renderPage();

    expect(screen.queryByRole('link', { name: '编辑这个话题' })).not.toBeInTheDocument();
  });

  it('keeps focus on the pin button and announces success after pinning', async () => {
    rootStore.session.signIn('jwt.token', {
      id: 'admin-id',
      username: 'admin',
      role: 'admin',
    });
    setPinnedMutate.mockImplementation((_input, handlers) => {
      setPinnedIsPending = true;
      void handlers.onSuccess?.({ pinned: true });
    });
    const user = userEvent.setup();
    const view = renderPage();

    const pinButton = screen.getByRole('button', { name: '置顶' });
    await user.click(pinButton);
    view.rerender(
      <MemoryRouter initialEntries={['/forum/test-topic']}>
        <Routes>
          <Route path="/forum/:slug" element={<ForumDetailPage />} />
          <Route path="/forum" element={<ForumLanding />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(setPinnedMutate.mock.calls[0]?.[0]).toEqual({
      id: '00000000-0000-0000-0000-000000000001',
      pinned: true,
    });
    expect(await screen.findByText('已置顶，话题会显示在列表最前')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正在置顶…' })).toBeDisabled();

    setPinnedIsPending = false;
    view.rerender(
      <MemoryRouter initialEntries={['/forum/test-topic']}>
        <Routes>
          <Route path="/forum/:slug" element={<ForumDetailPage />} />
          <Route path="/forum" element={<ForumLanding />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '置顶' })).toHaveFocus();
    expect(topicsListInvalidate).toHaveBeenCalled();
  });

  it('tabs the admin reply reason before delete and cancel, and keeps it after Esc clears it', async () => {
    rootStore.session.signIn('jwt.token', { id: 'admin-1', username: 'admin', role: 'admin' });
    deleteReplyMutate.mockImplementation((input, handlers) => {
      handlers.onError?.({ data: { code: 'INTERNAL_SERVER_ERROR' } }, input);
    });
    const user = userEvent.setup();
    renderPage();

    const trigger = screen.getByRole('button', { name: '删除 @user1 的回帖' });
    await user.click(trigger);
    const reason = screen.getByLabelText('删除原因（选填，只有管理员能看到）');
    const remove = screen.getByRole('button', { name: '删除' });
    const cancel = screen.getByRole('button', { name: '取消' });
    expect(cancel).toHaveFocus();
    reason.focus();
    await user.tab();
    expect(remove).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.type(reason, ' off topic ');
    await user.click(remove);
    expect(deleteReplyMutate).toHaveBeenCalledWith(
      { id: 'reply-01', reason: 'off topic' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(reason).toHaveValue(' off topic ');
    expect(screen.getByRole('alert')).toHaveTextContent('删除失败，请重试');

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '删除 @user1 的回帖' })).toHaveFocus(),
    );
    expect(screen.queryByLabelText('删除原因（选填，只有管理员能看到）')).not.toBeInTheDocument();
  });

  it('hides reply, edit, and report when the viewer is banned', () => {
    rootStore.session.signIn('jwt.token', {
      id: 'author-1',
      username: 'author',
      bannedAt: '2026-10-27T00:00:00.000Z',
    });
    renderPage();
    expect(screen.getByText('你的账号已被封禁，不能回帖。')).not.toHaveAttribute('role', 'alert');
    expect(screen.queryByRole('button', { name: '发布回帖' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /编辑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '举报' })).not.toBeInTheDocument();
  });

  it('keeps the reply draft when the write returns USER_BANNED', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('jwt.token', { id: 'user-current', username: 'alice' });
    createReplyMutate.mockImplementation((_input, handlers) => {
      handlers.onError?.({
        message: 'Prisma LEAK',
        data: { code: 'FORBIDDEN', appCode: 'USER_BANNED' },
      });
    });
    renderPage();
    const field = screen.getByLabelText('撰写回帖');
    await user.type(field, 'keep the reply');
    await user.click(screen.getByRole('button', { name: '发布回帖' }));
    expect(screen.getByRole('alert')).toHaveTextContent('你的账号已被封禁，这次操作没有完成。');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Prisma');
    expect(field).toHaveValue('keep the reply');
  });
});
