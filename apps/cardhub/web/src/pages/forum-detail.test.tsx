import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';

const topicInvalidate = vi.fn();
const repliesInvalidate = vi.fn();
const createReplyMutate = vi.fn();
const deleteReplyMutate = vi.fn();
const fetchNextPage = vi.fn();
const repliesReset = vi.fn();
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
        createdAt: string;
        updatedAt: string;
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

vi.mock('../lib/trpc', () => ({
  trpc: {
    forum: {
      topics: {
        bySlug: {
          useQuery: () => topicState,
        },
        delete: {
          useMutation: () => ({
            mutate: vi.fn(),
            isPending: false,
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
            onError?: (error: { message: string }) => void;
          }) => ({
            mutate: (input: unknown) => createReplyMutate(input, { onSuccess, onError }),
            isPending: false,
          }),
        },
        delete: {
          useMutation: ({ onSuccess }: { onSuccess?: () => void }) => ({
            mutate: (input: unknown) => deleteReplyMutate(input, { onSuccess }),
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
          bySlug: { invalidate: topicInvalidate },
        },
        replies: {
          list: { invalidate: repliesInvalidate, reset: repliesReset },
        },
      },
    }),
  },
}));

import { ForumDetailPage } from './forum-detail';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forum/test-topic']}>
      <Routes>
        <Route path="/forum/:slug" element={<ForumDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.session.signOut();
  topicInvalidate.mockClear();
  repliesInvalidate.mockClear();
  repliesReset.mockReset();
  repliesReset.mockImplementation(() => {
    repliesQueryState.cursor = latestInitialCursor;
    repliesQueryState.data = { pages: [] };
    repliesQueryState.hasNextPage = Boolean(latestInitialCursor);
  });
  createReplyMutate.mockReset();
  deleteReplyMutate.mockReset();
  fetchNextPage.mockReset();
  repliesQueryInputs.length = 0;
  latestInitialCursor = undefined;
  availableReplies = replies;
  fetchNextPage.mockImplementation(async () => {
    const cursor = repliesQueryState.data.pages.at(-1)?.nextCursor ?? repliesQueryState.cursor;
    const page = nextReplyPage(cursor);
    repliesQueryState.data = { pages: [...repliesQueryState.data.pages, page] };
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
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    author: { id: 'author-1', username: 'author' },
    replyCount: 45,
    replies: replies.slice(0, 20),
    replyNextCursor: replies[19]!.id,
  };
  repliesQueryState.cursor = undefined;
  repliesQueryState.data = { pages: [] };
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
  });
});
