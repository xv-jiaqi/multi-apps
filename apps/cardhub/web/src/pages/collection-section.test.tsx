import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import { sortCollectionProgress } from './collection-section';

type ProgressFixture = {
  seriesSlug: string;
  seriesTitle: string;
  owned: number;
  total: number;
};

type ItemFixture = {
  id: string;
  cardSlug: string;
  cardName: string;
  imageUrl: string | null;
  seriesSlug: string;
  seriesTitle: string;
  state: 'owned' | 'wanted';
  ownedCount: number;
  wanted: boolean;
};

const mock = vi.hoisted(() => ({
  listInput: { limit: 20, state: 'all' as 'all' | 'owned' | 'wanted' },
  progress: {
    data: undefined as { items: ProgressFixture[] } | undefined,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null as { data?: { appCode?: string }; message: string } | null,
    errorUpdateCount: 0,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  },
  list: {
    data: undefined as
      | { pages: Array<{ items: ItemFixture[]; nextCursor: string | null }> }
      | undefined,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null as { data?: { appCode?: string }; message: string } | null,
    errorUpdateCount: 0,
    dataUpdatedAt: 1,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  },
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    collection: {
      progress: { useQuery: () => mock.progress },
      list: {
        useInfiniteQuery: (input: { limit: number; state: 'all' | 'owned' | 'wanted' }) => {
          mock.listInput = input;
          return mock.list;
        },
      },
    },
  },
}));

import { CollectionSection } from './collection-section';

function renderSection() {
  return render(
    <MemoryRouter>
      <CollectionSection />
    </MemoryRouter>,
  );
}

function readyEmpty() {
  mock.progress.data = { items: [] };
  mock.progress.isLoading = false;
  mock.progress.isError = false;
  mock.progress.error = null;
  mock.progress.errorUpdateCount = 0;
  mock.list.data = { pages: [{ items: [], nextCursor: null }] };
  mock.list.isLoading = false;
  mock.list.isError = false;
  mock.list.error = null;
  mock.list.errorUpdateCount = 0;
  mock.list.hasNextPage = false;
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
  mock.listInput = { limit: 20, state: 'all' };
  mock.progress.refetch.mockReset();
  mock.list.refetch.mockReset();
  mock.list.fetchNextPage.mockReset();
  readyEmpty();
});

describe('sortCollectionProgress', () => {
  it('orders by completion, then the current locale title', () => {
    const sorted = sortCollectionProgress(
      [
        { seriesSlug: 'b', seriesTitle: '黄昏', owned: 1, total: 4 },
        { seriesSlug: 'a', seriesTitle: '黎明', owned: 1, total: 2 },
        { seriesSlug: 'c', seriesTitle: '白昼', owned: 1, total: 2 },
      ],
      'zh-CN',
    );
    expect(sorted.map((item) => item.seriesTitle)).toEqual(['白昼', '黎明', '黄昏']);
  });
});

describe('CollectionSection', () => {
  it('shows the dashed empty state when nothing is collected', () => {
    renderSection();
    expect(screen.getByRole('heading', { name: '我的收藏' })).toBeInTheDocument();
    expect(
      screen.getByText('还没有收藏。在卡牌页点「我有」或「想要」开始记录'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an error instead of the skeleton when a query is both failed and loading', () => {
    mock.progress.data = undefined;
    mock.progress.isLoading = true;
    mock.progress.isError = true;
    mock.progress.error = { data: { appCode: 'NOT_FOUND' }, message: 'missing' };
    mock.progress.errorUpdateCount = 1;
    mock.list.data = undefined;
    mock.list.isLoading = true;
    mock.list.isError = false;

    renderSection();

    expect(screen.getByRole('alert')).toHaveTextContent('内容不存在或已被删除');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('sorts progress, marks a complete series, and keeps a want-only series at 0', () => {
    mock.progress.data = {
      items: [
        { seriesSlug: 'dawn', seriesTitle: '黎明', owned: 2, total: 2 },
        { seriesSlug: 'dusk', seriesTitle: '黄昏', owned: 0, total: 3 },
      ],
    };
    mock.list.data = {
      pages: [
        {
          items: [
            {
              id: '1',
              cardSlug: 'alpha',
              cardName: '阿尔法',
              imageUrl: 'https://images.example.test/a.png',
              seriesSlug: 'dawn',
              seriesTitle: '黎明',
              state: 'owned',
              ownedCount: 2,
              wanted: true,
            },
          ],
          nextCursor: 'cursor-1',
        },
      ],
    };
    mock.list.hasNextPage = true;

    renderSection();

    const titles = screen
      .getAllByRole('link', { name: /黎明|黄昏/ })
      .map((node) => node.textContent);
    expect(titles).toEqual(['黎明', '黄昏']);
    expect(screen.getByText(/已有 2 \/ 共 2/)).toHaveTextContent('已集齐');
    expect(screen.getByText('已有 0 / 共 3')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '黄昏' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('progressbar', { name: '黄昏' })).toHaveAttribute('aria-valuemax', '3');
    expect(screen.getByRole('link', { name: '阿尔法' })).toHaveAttribute('href', '/cards/alpha');
    expect(screen.getByText('我有 ×2')).toBeInTheDocument();
    expect(screen.getAllByText('想要').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '加载更多' })).toBeInTheDocument();
  });

  it('asks the server for the next filter and shows none without load more', async () => {
    const user = userEvent.setup();
    mock.progress.data = {
      items: [{ seriesSlug: 'dawn', seriesTitle: '黎明', owned: 1, total: 2 }],
    };
    mock.list.data = {
      pages: [
        {
          items: [
            {
              id: '1',
              cardSlug: 'alpha',
              cardName: '阿尔法',
              imageUrl: null,
              seriesSlug: 'dawn',
              seriesTitle: '黎明',
              state: 'owned',
              ownedCount: 1,
              wanted: false,
            },
          ],
          nextCursor: null,
        },
      ],
    };

    const view = renderSection();
    expect(screen.getAllByText('我有').length).toBeGreaterThan(0);
    expect(screen.queryByText(/我有 ×/)).not.toBeInTheDocument();

    const wanted = screen.getByRole('button', { name: '想要' });
    await user.click(wanted);
    expect(wanted).toHaveFocus();
    await waitFor(() => expect(mock.listInput.state).toBe('wanted'));

    mock.list.data = { pages: [{ items: [], nextCursor: null }] };
    mock.list.hasNextPage = false;
    view.rerender(
      <MemoryRouter>
        <CollectionSection />
      </MemoryRouter>,
    );
    expect(screen.getByText('暂无')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });

  it('keeps a successful list when progress fails, and keeps cards when load-more fails', () => {
    mock.progress.data = undefined;
    mock.progress.isError = true;
    mock.progress.isLoading = false;
    mock.progress.error = { message: 'down' };
    mock.progress.errorUpdateCount = 2;
    mock.list.data = {
      pages: [
        {
          items: [
            {
              id: '1',
              cardSlug: 'alpha',
              cardName: '阿尔法',
              imageUrl: null,
              seriesSlug: 'dawn',
              seriesTitle: '黎明',
              state: 'wanted',
              ownedCount: 0,
              wanted: true,
            },
          ],
          nextCursor: 'next',
        },
      ],
    };
    mock.list.isError = true;
    mock.list.error = { data: { appCode: 'TOO_MANY_REQUESTS' }, message: 'slow' };
    mock.list.errorUpdateCount = 1;
    mock.list.hasNextPage = true;

    renderSection();

    expect(screen.getByText('阿尔法')).toBeInTheDocument();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '加载更多' })).toBeInTheDocument();
  });
});
