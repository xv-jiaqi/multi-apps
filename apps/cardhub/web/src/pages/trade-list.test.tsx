import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router';
import { rootStore } from '../stores/root-store';
import { TradeListPage } from './trade-list';

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = vi.fn();
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}
if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

type ListInput = {
  sort?: string;
  currency?: string;
  minPrice?: number;
  maxPrice?: number;
};

const listInputs = vi.hoisted(() => [] as ListInput[]);

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      listings: {
        list: { invalidate: vi.fn() },
        byCard: { invalidate: vi.fn() },
        mine: { invalidate: vi.fn() },
      },
    }),
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
    cards: {
      bySlug: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
      },
      search: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
    listings: {
      list: {
        useInfiniteQuery: (input: ListInput) => {
          listInputs.push(input);
          return {
            data: { pages: [{ items: [], nextCursor: null }] },
            isLoading: false,
            isError: false,
            isFetchingNextPage: false,
            hasNextPage: false,
            error: null,
            refetch: vi.fn(),
            fetchNextPage: vi.fn(),
          };
        },
      },
      close: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

function SearchProbe() {
  const [params] = useSearchParams();
  return <output aria-label="search">{params.toString()}</output>;
}

function renderTrade(search = '') {
  render(
    <MemoryRouter initialEntries={[`/trade${search}`]}>
      <Routes>
        <Route
          path="/trade"
          element={
            <>
              <TradeListPage />
              <SearchProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function latestInput() {
  const input = listInputs.at(-1);
  if (!input) throw new Error('listings.list was not called');
  return input;
}

describe('TradeListPage price filters', () => {
  beforeEach(() => {
    listInputs.length = 0;
    rootStore.session.signOut();
    rootStore.locale.setLocale('zh-CN');
  });

  it('defaults a price sort with no currency to CNY', async () => {
    renderTrade('?sort=price_desc');

    await screen.findByText('没有符合条件的意向');
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument();
    expect(latestInput()).toMatchObject({
      sort: 'price_desc',
      currency: 'CNY',
      minPrice: undefined,
      maxPrice: undefined,
    });
  });

  it('writes the default currency when a price range is committed without one in the URL', async () => {
    const user = userEvent.setup();
    renderTrade('?sort=price_asc');

    await user.type(screen.getByRole('textbox', { name: '最低价' }), '10');
    await user.type(screen.getByRole('textbox', { name: '最高价' }), '20');
    await user.tab();

    await waitFor(() => {
      const search = screen.getByLabelText('search').textContent ?? '';
      expect(search).toContain('sort=price_asc');
      expect(search).toContain('currency=CNY');
      expect(search).toContain('min=10');
      expect(search).toContain('max=20');
    });
    expect(latestInput()).toMatchObject({
      sort: 'price_asc',
      currency: 'CNY',
      minPrice: 10,
      maxPrice: 20,
    });
  });

  it('drops a price range when the URL has no currency', async () => {
    renderTrade('?min=10');

    await screen.findByText('暂无交易意向');
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument();
    expect(latestInput()).toMatchObject({
      sort: 'newest',
      currency: undefined,
      minPrice: undefined,
      maxPrice: undefined,
    });
  });

  it('resets a price sort when the currency chip is cleared', async () => {
    const user = userEvent.setup();
    renderTrade();

    const sortLabel = screen.getByText('排序').closest('label');
    if (!sortLabel) throw new Error('sort filter is missing');
    await user.click(within(sortLabel).getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(screen.getByLabelText('search')).toHaveTextContent('currency=CNY');
      expect(screen.getByLabelText('search')).toHaveTextContent('sort=price_asc');
    });
    expect(latestInput()).toMatchObject({ sort: 'price_asc', currency: 'CNY' });

    await user.click(screen.getByRole('button', { name: '清除 货币' }));

    await waitFor(() => {
      const search = screen.getByLabelText('search').textContent ?? '';
      expect(search).not.toContain('sort=');
      expect(search).not.toContain('currency=');
      expect(search).not.toContain('min=');
      expect(search).not.toContain('max=');
    });
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument();
    expect(latestInput()).toMatchObject({
      sort: 'newest',
      currency: undefined,
      minPrice: undefined,
      maxPrice: undefined,
    });
  });
});
