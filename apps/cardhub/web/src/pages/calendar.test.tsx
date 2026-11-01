import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { rootStore } from '../stores/root-store';
import { CalendarPage } from './calendar';

const list = {
  pages: [] as Array<{ items: Array<Record<string, unknown>>; nextCursor: string | null }>,
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  errorUpdateCount: 0,
  dataUpdatedAt: 1,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
};

vi.mock('../lib/shanghai-date', () => ({
  shanghaiToday: () => '2026-12-15',
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    releases: {
      list: {
        useInfiniteQuery: () => ({
          data: list.isLoading || list.isError ? undefined : { pages: list.pages },
          isLoading: list.isLoading,
          isPending: list.isPending,
          isFetching: list.isFetching,
          isError: list.isError,
          isFetchNextPageError: list.isFetchNextPageError,
          isFetchingNextPage: list.isFetchingNextPage,
          hasNextPage: list.hasNextPage,
          errorUpdateCount: list.errorUpdateCount,
          dataUpdatedAt: list.dataUpdatedAt,
          fetchNextPage: list.fetchNextPage,
          refetch: list.refetch,
        }),
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

function row(partial: Record<string, unknown>) {
  return {
    id: 'r1',
    title: '春季补充包',
    releaseDate: '2026-12-06',
    datePrecision: 'DAY',
    region: 'JP',
    note: '**纯文本**',
    sourceUrl: 'https://example.invalid/src',
    series: { slug: 'celestial-dawn', title: '天穹黎明', coverUrl: null },
    category: { slug: 'deck', name: '构筑对战' },
    seriesId: 'series-1',
    categoryId: 'cat-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function renderCalendar(path = '/calendar') {
  const router = createMemoryRouter([{ path: '/calendar', element: <CalendarPage /> }], {
    initialEntries: [path],
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  list.pages = [];
  list.isLoading = false;
  list.isPending = false;
  list.isFetching = false;
  list.isError = false;
  list.isFetchNextPageError = false;
  list.isFetchingNextPage = false;
  list.hasNextPage = false;
  list.errorUpdateCount = 0;
  list.dataUpdatedAt = 1;
  list.fetchNextPage.mockReset();
  list.refetch.mockReset();
});

describe('release calendar page', () => {
  it('replaces a bad month, keeps focus on the pressed control, and marks this month', async () => {
    const user = userEvent.setup();
    list.pages = [{ items: [], nextCursor: null }];
    const { router } = renderCalendar('/calendar?month=2026-13');

    expect(await screen.findByRole('heading', { level: 1, name: '发售日历' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?month=2026-12');
    expect(screen.getByRole('heading', { level: 2, name: '2026年12月' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
    const today = screen.getByRole('button', { name: '本月' });
    expect(today).toHaveAttribute('aria-disabled', 'true');
    today.focus();
    await user.click(today);
    expect(today).toHaveFocus();
    expect(router.state.location.search).toBe('?month=2026-12');

    const next = screen.getByRole('button', { name: '下个月' });
    await user.click(next);
    expect(next).toHaveFocus();
    expect(router.state.location.search).toBe('?month=2027-01');
    expect(screen.getByRole('heading', { level: 2, name: '2027年1月' })).toBeInTheDocument();
  });

  it('groups the month, links series cards, and leaves a series-less card as text', () => {
    list.pages = [
      {
        nextCursor: null,
        items: [
          row({ id: 'with-series', title: '有系列' }),
          row({
            id: 'plain',
            title: '无系列',
            series: null,
            seriesId: null,
            region: null,
            category: null,
            note: '只剩备注',
            sourceUrl: null,
          }),
          row({
            id: 'today',
            title: '今天发售',
            releaseDate: '2026-12-15',
            note: null,
            sourceUrl: null,
          }),
          row({
            id: 'month',
            title: '月份待定',
            datePrecision: 'MONTH',
            releaseDate: '2026-12-01',
            series: null,
            seriesId: null,
            note: null,
            sourceUrl: 'https://example.invalid/month',
          }),
        ],
      },
    ];
    renderCalendar('/calendar?month=2026-12');

    expect(screen.getByRole('heading', { level: 3, name: '12月6日 周日' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: '12月15日 周二 · 今天' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '本月内，日期待定' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2026年12月，共 4 条');

    const seriesLink = screen.getByRole('link', { name: '有系列' });
    const sources = screen.getAllByRole('link', { name: /来源/ });
    expect(seriesLink).toHaveAttribute('href', '/series/celestial-dawn');
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(seriesLink).not.toContainElement(source);
      expect(source).toHaveAttribute('rel', 'noopener noreferrer');
      expect(source).toHaveAttribute('target', '_blank');
    }
    expect(screen.getByRole('heading', { level: 4, name: '无系列' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '无系列' })).not.toBeInTheDocument();
    expect(screen.getByText('只剩备注')).toBeInTheDocument();
    expect(screen.getByText('**纯文本**').tagName).toBe('P');
    const monthCard = screen.getByRole('heading', { level: 4, name: '月份待定' }).closest('div');
    expect(monthCard).toHaveTextContent('12月内');

    const main = document.getElementById('main');
    expect(main?.scrollWidth).toBeLessThanOrEqual((main?.clientWidth ?? 0) + 1);
    expect(
      within(main as HTMLElement).getByRole('navigation', { name: '月份' }),
    ).toBeInTheDocument();
  });

  it('shows the empty month and an error that retries only the current query', async () => {
    const user = userEvent.setup();
    list.pages = [{ items: [], nextCursor: null }];
    const { unmount } = renderCalendar('/calendar?month=2026-12');
    expect(screen.getByText('这个月没有发售条目')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上个月' })).toBeEnabled();
    unmount();

    list.isError = true;
    list.isPending = false;
    list.isLoading = false;
    list.pages = [];
    list.errorUpdateCount = 1;
    list.dataUpdatedAt = 0;
    renderCalendar('/calendar?month=2026-12');
    expect(screen.getByRole('alert')).toHaveTextContent('发售日历加载失败');
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(list.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '下个月' })).toBeInTheDocument();
  });

  it('keeps the skeleton up while another page is outstanding and switches copy', () => {
    list.isLoading = true;
    list.isPending = true;
    list.isFetching = true;
    list.dataUpdatedAt = 0;
    const { unmount } = renderCalendar('/calendar?month=2026-12');
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText('这个月没有发售条目')).not.toBeInTheDocument();
    unmount();

    list.isLoading = false;
    list.isPending = false;
    list.isFetching = false;
    list.hasNextPage = true;
    list.isFetchingNextPage = false;
    list.dataUpdatedAt = 1;
    list.pages = [{ items: [row({})], nextCursor: 'next' }];
    renderCalendar('/calendar?month=2026-12');
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 4, name: '春季补充包' })).not.toBeInTheDocument();
    expect(list.fetchNextPage).toHaveBeenCalled();
  });

  it('uses the English month status for a single release', () => {
    rootStore.locale.setLocale('en-US');
    list.pages = [{ items: [row({ id: 'only', series: null, seriesId: null })], nextCursor: null }];
    renderCalendar('/calendar?month=2026-12');
    expect(screen.getByRole('heading', { level: 2, name: 'December 2026' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('December 2026, 1 release');
    expect(screen.getByRole('heading', { level: 3, name: 'Sun, Dec 6' })).toBeInTheDocument();
  });
});
