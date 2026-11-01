import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { rootStore } from '../../stores/root-store';
import { AdminReleasesPage } from './releases';

const list = {
  items: [] as Array<Record<string, unknown>>,
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  error: null as unknown,
  errorUpdateCount: 0,
  dataUpdatedAt: 1,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
};

const remove = vi.fn();

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      admin: { releases: { list: { invalidate: vi.fn() } } },
      releases: { list: { invalidate: vi.fn() } },
    }),
    admin: {
      releases: {
        list: {
          useInfiniteQuery: () => ({
            data:
              list.isLoading || (list.isError && list.items.length === 0)
                ? undefined
                : { pages: [{ items: list.items, nextCursor: list.hasNextPage ? 'next' : null }] },
            isLoading: list.isLoading,
            isPending: list.isPending,
            isFetching: list.isFetching,
            isError: list.isError,
            isFetchNextPageError: list.isFetchNextPageError,
            isFetchingNextPage: list.isFetchingNextPage,
            hasNextPage: list.hasNextPage,
            error: list.error,
            errorUpdateCount: list.errorUpdateCount,
            dataUpdatedAt: list.dataUpdatedAt,
            fetchNextPage: list.fetchNextPage,
            refetch: list.refetch,
          }),
        },
        delete: {
          useMutation: () => ({ mutateAsync: remove, isPending: false }),
        },
      },
    },
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
  },
}));

function renderPage() {
  const router = createMemoryRouter([{ path: '/admin/releases', element: <AdminReleasesPage /> }], {
    initialEntries: ['/admin/releases'],
  });
  return render(<RouterProvider router={router} />);
}

function entry(partial: Record<string, unknown>) {
  return {
    id: 'r1',
    title: '春季补充包',
    releaseDate: '2026-12-06',
    datePrecision: 'DAY',
    region: 'CN',
    series: { slug: 'celestial-dawn', title: '天穹黎明' },
    seriesId: 'series-1',
    categoryId: null,
    category: null,
    note: null,
    sourceUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  list.items = [];
  list.isLoading = false;
  list.isPending = false;
  list.isFetching = false;
  list.isError = false;
  list.isFetchNextPageError = false;
  list.isFetchingNextPage = false;
  list.hasNextPage = false;
  list.error = null;
  list.errorUpdateCount = 0;
  list.dataUpdatedAt = 1;
  list.fetchNextPage.mockReset();
  list.refetch.mockReset();
  remove.mockReset();
  remove.mockResolvedValue({ id: 'r1' });
});

describe('admin release list', () => {
  it('shows loading, empty, and error with retry', async () => {
    const user = userEvent.setup();
    list.isLoading = true;
    list.isPending = true;
    list.isFetching = true;
    const { unmount } = renderPage();
    expect(screen.getByRole('table', { name: '发售条目' })).toHaveAttribute('aria-busy', 'true');
    unmount();

    list.isLoading = false;
    list.isPending = false;
    list.isFetching = false;
    const empty = renderPage();
    expect(screen.getByText('还没有发售条目')).toBeInTheDocument();
    empty.unmount();

    list.isError = true;
    list.errorUpdateCount = 1;
    list.dataUpdatedAt = 0;
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('发售条目加载失败');
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(list.refetch).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the row delete button and then to the first remaining row', async () => {
    const user = userEvent.setup();
    list.items = [
      entry({ id: 'first', title: '先发售' }),
      entry({ id: 'second', title: '后发售', releaseDate: '2026-11-02' }),
    ];
    renderPage();

    await user.click(screen.getByRole('button', { name: '删除「后发售」' }));
    const cancel = screen.getByRole('button', { name: '取消' });
    expect(cancel).toHaveFocus();
    expect(screen.getByRole('heading', { name: '删除这个发售条目？' })).toBeInTheDocument();
    expect(screen.getByText('「后发售」会从日历上消失，系列不受影响。')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '删除「后发售」' })).toHaveFocus();
    });

    await user.click(screen.getByRole('button', { name: '删除「先发售」' }));
    await user.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '删除这个发售条目？' })).not.toBeInTheDocument();
    });
    expect(remove).toHaveBeenCalledWith({ id: 'first' });
    expect(screen.queryByText('先发售')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '删除「后发售」' })).toHaveFocus();
    });
  });

  it('treats a missing row as deleted and ignores clicks while loading more', async () => {
    const user = userEvent.setup();
    remove.mockRejectedValue({
      message: '发售条目不存在',
      data: { code: 'NOT_FOUND', appCode: 'NOT_FOUND' },
    });
    list.items = [entry({ id: 'only', title: '只此一条', series: null })];
    const { unmount } = renderPage();
    await user.click(screen.getByRole('button', { name: '删除「只此一条」' }));
    await user.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: '新建条目' })).toHaveFocus();
    });
    expect(screen.getByText('还没有发售条目')).toBeInTheDocument();
    unmount();

    list.items = [entry({})];
    list.hasNextPage = true;
    list.isFetchingNextPage = true;
    renderPage();
    const more = screen.getByRole('button', { name: '加载中…' });
    expect(more).toHaveAttribute('aria-disabled', 'true');
    await user.click(more);
    expect(list.fetchNextPage).not.toHaveBeenCalled();
  });

  it('keeps the loading skeleton out of the scroll region and names the loaded list', () => {
    list.isLoading = true;
    list.isPending = true;
    list.isFetching = true;
    const loading = renderPage();
    const busy = screen.getByRole('table', { name: '发售条目' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.parentElement).not.toHaveAttribute('role', 'region');
    expect(busy).not.toHaveClass('min-w-160');
    loading.unmount();

    list.isLoading = false;
    list.isPending = false;
    list.isFetching = false;
    list.items = [entry({})];
    const loaded = renderPage();
    const region = screen.getByRole('region', { name: '发售条目列表' });
    expect(region.tabIndex).toBe(0);
    expect(region).toHaveClass(
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-brand-500',
      'focus-visible:ring-offset-2',
    );
    expect(screen.getByRole('table', { name: '发售条目' }).parentElement).toBe(region);
    loaded.unmount();

    rootStore.locale.setLocale('en-US');
    renderPage();
    const english = screen.getByRole('region', { name: 'Release entries' });
    expect(english.tabIndex).toBe(0);
    expect(screen.getByRole('table', { name: 'Releases' }).parentElement).toBe(english);
  });
});
