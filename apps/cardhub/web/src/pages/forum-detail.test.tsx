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

const replies = Array.from({ length: 25 }, (_, index) => makeReply(index + 1));

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
    pages: [
      {
        items: replies.slice(20),
        nextCursor: null,
      },
    ],
  },
  hasNextPage: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
};

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
          useInfiniteQuery: () => ({
            ...repliesQueryState,
            fetchNextPage,
          }),
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
          list: { invalidate: repliesInvalidate },
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
  createReplyMutate.mockReset();
  deleteReplyMutate.mockReset();
  fetchNextPage.mockReset();
  fetchNextPage.mockResolvedValue({ data: repliesQueryState.data });
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
    replyCount: 25,
    replies: replies.slice(0, 20),
    replyNextCursor: replies[19]!.id,
  };
  repliesQueryState.data.pages = [{ items: replies.slice(20), nextCursor: null }];
  repliesQueryState.hasNextPage = false;
  repliesQueryState.isFetchingNextPage = false;
  repliesQueryState.isFetchNextPageError = false;
});

describe('ForumDetailPage replies pagination', () => {
  it('renders the first 20 replies and reveals the remaining 5 after loading more', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText('Reply 1')).toBeInTheDocument();
    expect(screen.getByText('Reply 20')).toBeInTheDocument();
    expect(screen.queryByText('Reply 21')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '加载更多回帖' }));

    expect(screen.getByText('Reply 21')).toBeInTheDocument();
    expect(screen.getByText('Reply 25')).toBeInTheDocument();
    expect(screen.getByText('已显示全部回帖')).toBeInTheDocument();
    expect(screen.getAllByText(/^Reply \d+$/)).toHaveLength(25);
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
});
