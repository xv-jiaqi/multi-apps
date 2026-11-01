import { appErrorMessage } from '@repo/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';

interface Row {
  id: string;
  type: string;
  actor: { username: string } | null;
  excerpt: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
  action?: string;
}

const unreadOptions: unknown[] = [];
const listOptions: unknown[] = [];
const markReadMock = vi.fn();
const markAllMock = vi.fn();
let failMarkAll = false;
let failNextPage = false;

const unreadState: {
  data: { count: number } | undefined;
  isError: boolean;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  errorUpdateCount: number;
  dataUpdatedAt: number;
} = {
  data: undefined,
  isError: false,
  isLoading: false,
  isPending: false,
  isFetching: false,
  errorUpdateCount: 0,
  dataUpdatedAt: 0,
};

const listState: {
  data: { pages: Array<{ items: Row[]; nextCursor: string | null }> } | undefined;
  error: { data?: { appCode?: string } } | null;
  isError: boolean;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  errorUpdateCount: number;
  dataUpdatedAt: number;
  fetchNextPage: () => Promise<{ isError: boolean; data?: typeof listState.data }>;
  refetch: () => Promise<{ isError: boolean; data?: typeof listState.data; error: unknown }>;
} = {
  data: undefined,
  error: null,
  isError: false,
  isLoading: false,
  isPending: false,
  isFetching: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  hasNextPage: false,
  errorUpdateCount: 0,
  dataUpdatedAt: 0,
  fetchNextPage: () => Promise.resolve({ isError: false, data: listState.data }),
  refetch: () => Promise.resolve({ isError: false, data: listState.data, error: null }),
};

function row(partial: Partial<Row> & Pick<Row, 'id'>): Row {
  return {
    type: 'TOPIC_REPLY',
    actor: { username: 'ada' },
    excerpt: 'hello',
    href: '/forum/topic#reply-2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
    readAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    ...partial,
  };
}

vi.mock('../lib/trpc', () => ({
  trpc: {
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
        }),
      },
    },
    notifications: {
      unreadCount: {
        useQuery: (_input: unknown, options: unknown) => {
          unreadOptions.push(options);
          return unreadState;
        },
      },
      list: {
        useInfiniteQuery: (_input: unknown, options: unknown) => {
          listOptions.push(options);
          return listState;
        },
      },
      markRead: {
        useMutation: () => ({
          mutate: (input: { id: string }, opts?: { onError?: () => void }) => {
            markReadMock(input);
            if (input.id === 'fail') opts?.onError?.();
          },
          isPending: false,
        }),
      },
      markAllRead: {
        useMutation: () => ({
          mutate: (_input: unknown, opts?: { onError?: () => void }) => {
            markAllMock();
            if (failMarkAll) opts?.onError?.();
          },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      notifications: {
        list: {
          getInfiniteData: () => listState.data,
          setInfiniteData: (
            _input: unknown,
            updater: (current: typeof listState.data) => typeof listState.data,
          ) => {
            listState.data = typeof updater === 'function' ? updater(listState.data) : updater;
          },
        },
        unreadCount: {
          getData: () => unreadState.data,
          setData: (
            _input: unknown,
            updater:
              | { count: number }
              | undefined
              | ((current: { count: number } | undefined) => { count: number } | undefined),
          ) => {
            unreadState.data = typeof updater === 'function' ? updater(unreadState.data) : updater;
          },
        },
      },
    }),
  },
}));

import { NotificationsPage } from './notifications';

function LoginProbe() {
  const location = useLocation();
  const state = location.state as { from?: string } | null;
  return <p>login-from:{state?.from ?? ''}</p>;
}

function renderPage(path = '/notifications') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/forum/:slug" element={<p>forum-page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  unreadOptions.length = 0;
  listOptions.length = 0;
  markReadMock.mockReset();
  markAllMock.mockReset();
  failMarkAll = false;
  failNextPage = false;
  unreadState.data = undefined;
  unreadState.isError = false;
  unreadState.isLoading = false;
  unreadState.isPending = false;
  unreadState.isFetching = false;
  unreadState.errorUpdateCount = 0;
  unreadState.dataUpdatedAt = 0;
  listState.data = undefined;
  listState.error = null;
  listState.isError = false;
  listState.isLoading = false;
  listState.isPending = false;
  listState.isFetching = false;
  listState.isFetchingNextPage = false;
  listState.isFetchNextPageError = false;
  listState.hasNextPage = false;
  listState.errorUpdateCount = 0;
  listState.dataUpdatedAt = 0;
  sessionStorage.clear();
});

describe('NotificationsPage', () => {
  it('sends an anonymous visitor to login and does not enable the count query', () => {
    renderPage('/notifications?tab=1#top');

    expect(screen.getByText('login-from:/notifications?tab=1#top')).toBeInTheDocument();
    expect(unreadOptions).toEqual([expect.objectContaining({ enabled: false })]);
    expect(screen.queryByRole('link', { name: '通知' })).not.toBeInTheDocument();
  });

  it('shows the skeleton before the first response and prefers an error over that skeleton', () => {
    rootStore.session.signIn('token', { id: 'u1', username: 'ada', role: 'user' });
    listState.isLoading = true;
    listState.isPending = true;
    listState.isFetching = true;
    const loading = renderPage();
    expect(screen.getAllByText('加载中…').length).toBeGreaterThan(0);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.querySelector('.motion-reduce\\:animate-none')).not.toBeNull();
    loading.unmount();

    listState.isError = true;
    listState.isLoading = true;
    listState.isPending = true;
    listState.isFetching = true;
    listState.errorUpdateCount = 1;
    listState.dataUpdatedAt = 0;
    listState.error = { data: { appCode: 'INTERNAL_SERVER_ERROR' } };
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent(
      appErrorMessage('zh-CN', 'INTERNAL_SERVER_ERROR'),
    );
    expect(document.querySelector('ul[aria-hidden="true"]')).toBeNull();
  });

  it('shows the empty state without a button', () => {
    rootStore.session.signIn('token', { id: 'u1', username: 'ada', role: 'user' });
    unreadState.data = { count: 0 };
    listState.data = { pages: [{ items: [], nextCursor: null }] };
    listState.dataUpdatedAt = 1;
    renderPage();

    expect(screen.getByRole('heading', { name: '通知' })).toBeInTheDocument();
    expect(document.title).toBe('通知 · Cardhub');
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    expect(screen.getByRole('status')).toHaveTextContent('没有未读通知');
    expect(screen.getByText('还没有通知')).toBeInTheDocument();
    expect(screen.getByText(/有人回复你/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
    const markAll = screen.getByRole('button', { name: '全部标记为已读' });
    expect(markAll).toHaveAttribute('aria-disabled', 'true');
  });

  it('marks every row read, keeps focus on the button, and rolls the row back when it fails', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'u1', username: 'ada', role: 'user' });
    unreadState.data = { count: 1 };
    listState.data = { pages: [{ items: [row({ id: 'n1' })], nextCursor: null }] };
    listState.dataUpdatedAt = 1;
    renderPage();

    const button = screen.getByRole('button', { name: '全部标记为已读' });
    expect(button).not.toHaveAttribute('aria-disabled');
    await user.click(button);
    expect(markAllMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('没有未读通知');
    expect(screen.getByRole('link', { name: /回复了你的话题/ })).not.toHaveTextContent('未读：');
  });

  it('opens the original post, remembers the row, and shows a deleted target as text', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'u1', username: 'ada', role: 'user' });
    unreadState.data = { count: 2 };
    listState.data = {
      pages: [
        {
          items: [
            row({ id: 'n1' }),
            row({
              id: 'gone',
              href: null,
              type: 'MENTION',
              actor: null,
              excerpt: 'old',
            }),
          ],
          nextCursor: null,
        },
      ],
    };
    listState.dataUpdatedAt = 1;
    renderPage();

    expect(screen.getByText('已注销用户')).toBeInTheDocument();
    expect(screen.getByText('原内容已删除')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /原内容已删除/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '标为已读' }));
    expect(markReadMock).toHaveBeenCalledWith({ id: 'gone' });

    await user.click(screen.getByRole('link', { name: /未读：/ }));
    expect(markReadMock).toHaveBeenCalledWith({ id: 'n1' });
    expect(sessionStorage.getItem('cardhub:notifications:focus')).toBe('n1');
    expect(screen.getByText('forum-page')).toBeInTheDocument();
  });

  it('moves focus to the first new row after load more and keeps loaded rows when the next page fails', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'u1', username: 'ada', role: 'user' });
    const first = row({ id: 'n1', excerpt: 'first' });
    const second = row({ id: 'n2', excerpt: 'second', readAt: '2026-05-02T00:00:00.000Z' });
    unreadState.data = { count: 1 };
    listState.data = { pages: [{ items: [first], nextCursor: 'cursor' }] };
    listState.hasNextPage = true;
    listState.dataUpdatedAt = 1;
    listState.fetchNextPage = () => {
      if (failNextPage) {
        listState.isFetchNextPageError = true;
        listState.error = { data: { appCode: 'INTERNAL_SERVER_ERROR' } };
        listState.errorUpdateCount += 1;
        return Promise.resolve({ isError: true, data: listState.data });
      }
      listState.data = {
        pages: [
          { items: [first], nextCursor: 'cursor' },
          { items: [second], nextCursor: null },
        ],
      };
      listState.hasNextPage = false;
      return Promise.resolve({ isError: false, data: listState.data });
    };
    const view = renderPage();

    await user.click(screen.getByRole('button', { name: '加载更多' }));
    expect(screen.getByText('second')).toBeInTheDocument();
    const secondLink = screen.getByRole('link', { name: /second/ });
    expect(secondLink).toHaveFocus();

    failNextPage = true;
    listState.hasNextPage = true;
    view.rerender(
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: '加载更多' }));
    view.rerender(
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('出了点问题，请稍后再试');
  });

  it('offers new rows only after the count grows and does not announce them from the badge', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'u1', username: 'ada', role: 'user' });
    unreadState.data = { count: 1 };
    listState.data = { pages: [{ items: [row({ id: 'n1' })], nextCursor: null }] };
    listState.dataUpdatedAt = 1;
    const view = renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('1 条未读');
    expect(screen.queryByRole('button', { name: /新通知/ })).not.toBeInTheDocument();

    unreadState.data = { count: 3 };
    view.rerender(
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('1 条未读');
    const bell = screen.getAllByRole('link', { name: '通知，3 条未读' })[0];
    expect(bell).toBeDefined();
    expect(bell?.closest('[aria-live]')).toBeNull();
    await user.click(screen.getByRole('button', { name: '有 2 条新通知' }));
    expect(screen.getByRole('status')).toHaveTextContent('3 条未读');
  });

  it('rolls a deleted-target mark back and repeats the alert', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'u1', username: 'ada', role: 'user' });
    unreadState.data = { count: 1 };
    listState.data = {
      pages: [{ items: [row({ id: 'fail', href: null, excerpt: 'gone' })], nextCursor: null }],
    };
    listState.dataUpdatedAt = 1;
    renderPage();

    const button = screen.getByRole('button', { name: '标为已读' });
    await user.click(button);
    const item = button.closest('li');
    if (!(item instanceof HTMLElement)) throw new Error('条目不存在');
    expect(within(item).getByRole('alert')).toHaveTextContent('操作失败，请重试。');
    expect(within(item).getByText('未读：')).toBeInTheDocument();
  });
});
