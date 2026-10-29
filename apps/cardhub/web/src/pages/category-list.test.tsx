import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

const refetch = vi.fn();
const queryState = {
  data: undefined as
    | {
        items: Array<{
          id: string;
          slug: string;
          name: string;
          description: string | null;
          sortOrder: number;
          seriesCount: number;
        }>;
      }
    | undefined,
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  error: null as { message: string } | null,
  errorUpdateCount: 0,
  dataUpdatedAt: 1,
};

vi.mock('../lib/trpc', () => ({
  trpc: {
    search: {
      global: {
        useQuery: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false }),
      },
    },
    categories: {
      list: {
        useQuery: () => ({ ...queryState, refetch }),
      },
    },
  },
}));

import { CategoryListPage } from './category-list';

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  queryState.data = undefined;
  queryState.isLoading = false;
  queryState.isPending = false;
  queryState.isFetching = false;
  queryState.isError = false;
  queryState.error = { message: 'database exploded' };
  queryState.errorUpdateCount = 0;
  queryState.dataUpdatedAt = 1;
  refetch.mockReset();
});

describe('CategoryListPage', () => {
  it('shows categories and their series counts', () => {
    queryState.data = {
      items: [
        {
          id: 'c1',
          slug: 'deck-builder',
          name: '构筑对战',
          description: '套牌',
          sortOrder: 0,
          seriesCount: 2,
        },
      ],
    };
    render(
      <MemoryRouter>
        <CategoryListPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: '分类' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /构筑对战/ })).toHaveAttribute(
      'href',
      '/categories/deck-builder',
    );
    expect(screen.getByText('2 个系列')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    queryState.data = { items: [] };
    render(
      <MemoryRouter>
        <CategoryListPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('还没有分类')).toBeInTheDocument();
  });

  it('shows a fixed error and retries without the server message', async () => {
    queryState.isError = true;
    queryState.isPending = true;
    queryState.dataUpdatedAt = 0;
    queryState.errorUpdateCount = 1;
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CategoryListPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败');
    expect(screen.queryByText('database exploded')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(refetch).toHaveBeenCalled();
  });
});
