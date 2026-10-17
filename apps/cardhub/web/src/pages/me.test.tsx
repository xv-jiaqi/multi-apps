import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';

type QueryState<T> = {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: { data?: { code?: string }; message: string } | null;
  refetch: ReturnType<typeof vi.fn>;
};

type InfiniteState<T> = QueryState<{ pages: Array<{ items: T[]; nextCursor: string | null }> }> & {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: ReturnType<typeof vi.fn>;
};

type ListingFixture = {
  id: string;
  cardSlug: string;
  kind: 'SELL' | 'BUY';
  price: string | null;
  currency: string;
  imageUrls: string[];
  contact: string;
  note: string | null;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  seller: { id: string; username: string };
};

type TopicFixture = {
  id: string;
  slug: string;
  title: string;
  replyCount: number;
  createdAt: string;
};

type CommentFixture = {
  id: string;
  body: string;
  createdAt: string;
  cardSlug: string;
  cardName: string;
  cardImageUrl: string | null;
};

function makeInfiniteState<T>(fn = vi.fn): InfiniteState<T> {
  return {
    data: { pages: [{ items: [], nextCursor: null }] },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: fn(),
  };
}

const mock = vi.hoisted(() => {
  const makeState = () => ({
    data: { pages: [{ items: [], nextCursor: null }] },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });

  return {
    mutateClose: vi.fn(),
    setInfiniteData: vi.fn(),
    meState: {
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
      refetch: vi.fn(),
    },
    listingState: makeState(),
    topicState: makeState(),
    commentState: makeState(),
  };
});

const mutateClose = mock.mutateClose;
const setInfiniteData = mock.setInfiniteData;
const meState = mock.meState as QueryState<{
  id: string;
  email: string;
  username: string;
  role: string;
  createdAt: string;
  listingCount: number;
  listingTotalCount: number;
  topicCount: number;
  replyCount: number;
  commentCount: number;
}>;
const listingState = mock.listingState as InfiniteState<ListingFixture>;
const topicState = mock.topicState as InfiniteState<TopicFixture>;
const commentState = mock.commentState as InfiniteState<CommentFixture>;

function listing(id: string, status: 'OPEN' | 'CLOSED' = 'OPEN'): ListingFixture {
  return {
    id,
    cardSlug: `card-${id}`,
    kind: 'SELL',
    price: '12.00',
    currency: 'CNY',
    imageUrls: [],
    contact: 'wechat',
    note: null,
    status,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    seller: { id: 'u1', username: 'alice' },
  };
}

function LoginProbe() {
  const location = useLocation();
  return <p data-testid="login-from">{String(location.state?.from ?? '')}</p>;
}

vi.mock('../lib/trpc', () => ({
  trpc: {
    users: {
      me: {
        useQuery: () => mock.meState,
      },
      myTopics: {
        useInfiniteQuery: () => mock.topicState,
      },
      myComments: {
        useInfiniteQuery: () => mock.commentState,
      },
    },
    listings: {
      mine: {
        useInfiniteQuery: () => mock.listingState,
        setInfiniteData: mock.setInfiniteData,
      },
      close: {
        useMutation: ({
          onSuccess,
          onError,
        }: {
          onSuccess?: () => void;
          onError?: (error: { data?: { code?: string } }) => void;
        }) => ({
          mutate: (input: unknown) => mock.mutateClose(input, { onSuccess, onError }),
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      listings: {
        mine: {
          setInfiniteData: (
            input: unknown,
            updater: (data: typeof mock.listingState.data) => typeof mock.listingState.data,
          ) => {
            mock.setInfiniteData(input, updater);
            mock.listingState.data = updater(mock.listingState.data);
          },
        },
      },
    }),
  },
}));

import { MePage } from './me';

function renderMe(initialEntry = '/me') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/me" element={<MePage />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  rootStore.session.signOut();
  rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });

  meState.data = {
    id: 'u1',
    email: 'alice@cardhub.test',
    username: 'alice',
    role: 'user',
    createdAt: '2026-05-01T00:00:00.000Z',
    listingCount: 1,
    listingTotalCount: 3,
    topicCount: 2,
    replyCount: 5,
    commentCount: 4,
  };
  meState.isLoading = false;
  meState.isError = false;
  meState.isSuccess = true;
  meState.error = null;
  meState.refetch.mockReset();

  Object.assign(listingState, makeInfiniteState<ListingFixture>());
  listingState.data = {
    pages: [{ items: [listing('1'), listing('2', 'CLOSED')], nextCursor: null }],
  };
  Object.assign(topicState, makeInfiniteState<TopicFixture>());
  topicState.data = {
    pages: [
      {
        items: [
          {
            id: 'topic-1',
            slug: 'topic-one',
            title: 'Topic one',
            replyCount: 6,
            createdAt: '2026-05-02T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
    ],
  };
  Object.assign(commentState, makeInfiniteState<CommentFixture>());
  commentState.data = {
    pages: [
      {
        items: [
          {
            id: 'comment-1',
            body: 'Great card',
            cardSlug: 'aurora-knight',
            cardName: 'Aurora Knight',
            cardImageUrl: 'https://img.cardhub.test/a.jpg',
            createdAt: '2026-05-03T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
    ],
  };
  mutateClose.mockReset();
  mutateClose.mockImplementation((_input, { onSuccess }) => {
    onSuccess?.();
  });
  setInfiniteData.mockReset();
});

describe('MePage', () => {
  it('redirects anonymous users to login with the hash in state.from', () => {
    rootStore.session.signOut();

    renderMe('/me?tab=1#me-comments');

    expect(screen.getByTestId('login-from')).toHaveTextContent('/me?tab=1#me-comments');
  });

  it('uses listingTotalCount for overview and listing anchor counts', () => {
    renderMe();

    expect(screen.getByRole('heading', { name: '@alice' })).toBeInTheDocument();
    expect(screen.getAllByText('交易意向')[0]?.nextElementSibling).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: '我的意向3' })).toBeInTheDocument();
  });

  it('renders independent loading, empty, and error states by section', () => {
    meState.isLoading = true;
    meState.isSuccess = false;
    listingState.data = { pages: [{ items: [], nextCursor: null }] };
    topicState.isError = true;
    topicState.isSuccess = false;
    topicState.error = { message: 'boom' };
    commentState.data = { pages: [{ items: [], nextCursor: null }] };

    renderMe();

    expect(screen.getByLabelText('个人中心分区')).toBeInTheDocument();
    expect(screen.getByText('你还没有发布过交易意向')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败');
    expect(screen.getByText('你还没有发表过评论')).toBeInTheDocument();
  });

  it('keeps loaded listing pages, marks a listing closed, and focuses the success notice', async () => {
    const user = userEvent.setup();
    listingState.data = {
      pages: [
        { items: [listing('1')], nextCursor: '1' },
        { items: [listing('2')], nextCursor: null },
      ],
    };

    renderMe();

    await user.click(screen.getAllByRole('button', { name: '关闭这条意向' })[0]!);
    await user.click(screen.getByRole('button', { name: '关闭意向' }));

    expect(setInfiniteData).toHaveBeenCalledWith({ limit: 10 }, expect.any(Function));
    expect(screen.getByText('card-2')).toBeInTheDocument();
    expect(screen.getAllByText('已关闭').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus());
  });

  it('keeps focus on load-more when more pages remain', async () => {
    const user = userEvent.setup();
    listingState.hasNextPage = true;
    listingState.data = { pages: [{ items: [listing('1')], nextCursor: '1' }] };
    listingState.fetchNextPage.mockResolvedValueOnce({
      isError: false,
      hasNextPage: true,
      data: listingState.data,
    });

    renderMe();

    const button = screen.getByRole('button', { name: '加载更多' });
    await user.click(button);

    await waitFor(() => expect(button).toHaveFocus());
  });

  it('focuses the first newly loaded row when the final page is loaded', async () => {
    const user = userEvent.setup();
    listingState.hasNextPage = true;
    listingState.data = { pages: [{ items: [listing('1')], nextCursor: '1' }] };
    listingState.fetchNextPage.mockImplementationOnce(async () => {
      listingState.hasNextPage = false;
      listingState.data = {
        pages: [
          { items: [listing('1')], nextCursor: '1' },
          { items: [listing('2')], nextCursor: null },
        ],
      };
      return { isError: false, hasNextPage: false, data: listingState.data };
    });

    renderMe();

    await user.click(screen.getByRole('button', { name: '加载更多' }));

    expect(await screen.findByText('card-2')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('card-2').closest('li')).toHaveFocus());
  });

  it('renders /me links in the desktop header and mobile drawer', async () => {
    const user = userEvent.setup();
    renderMe();

    expect(screen.getByRole('link', { name: '@alice 的个人中心' })).toHaveAttribute('href', '/me');
    await user.click(screen.getByRole('button', { name: '打开导航菜单' }));
    expect(screen.getByRole('link', { name: /个人中心 @alice/ })).toHaveAttribute('href', '/me');
  });

  it('moves focus to the target h2 when an anchor is clicked', async () => {
    const user = userEvent.setup();
    renderMe();

    await user.click(screen.getByRole('link', { name: '我的评论4' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: '我的评论 4' })).toHaveFocus());
  });
});
