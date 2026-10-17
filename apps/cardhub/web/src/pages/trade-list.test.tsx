import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const listHarness = vi.hoisted(() => ({
  inputs: [] as ListInput[],
  items: [] as Array<Record<string, unknown>>,
  isError: false,
  errorMessage: 'network down',
}));

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
          listHarness.inputs.push(input);
          return {
            data: { pages: [{ items: listHarness.items, nextCursor: null }] },
            isLoading: false,
            isError: listHarness.isError,
            isFetchingNextPage: false,
            hasNextPage: false,
            error: listHarness.isError ? { message: listHarness.errorMessage } : null,
            refetch: vi.fn(),
            fetchNextPage: vi.fn(),
          };
        },
      },
      close: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    reports: {
      create: {
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
  const input = listHarness.inputs.at(-1);
  if (!input) throw new Error('listings.list was not called');
  return input;
}

function searchText() {
  return screen.getByLabelText('search').textContent ?? '';
}

async function openSort(user: ReturnType<typeof userEvent.setup>) {
  const sortLabel = screen.getByText('排序').closest('label');
  if (!sortLabel) throw new Error('sort filter is missing');
  await user.click(within(sortLabel).getByRole('combobox'));
}

function listingWithPhoto(imageUrls: string[]) {
  return {
    id: 'l1',
    cardSlug: 'aurora-knight',
    card: {
      slug: 'aurora-knight',
      name: '极光骑士',
      imageUrl: null,
      seriesSlug: 'starter',
      seriesTitle: '启程',
    },
    kind: 'SELL',
    price: '200.00',
    currency: 'USD',
    imageUrls,
    contact: 'qa',
    note: null,
    condition: null,
    language: null,
    variantNote: null,
    status: 'OPEN',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    seller: { id: 'seller', username: 'qa' },
  };
}

describe('TradeListPage price filters', () => {
  beforeEach(() => {
    listHarness.inputs.length = 0;
    listHarness.items = [];
    listHarness.isError = false;
    listHarness.errorMessage = 'network down';
    rootStore.session.signOut();
    rootStore.locale.setLocale('zh-CN');
  });

  it('defaults a price sort with no currency to CNY', async () => {
    renderTrade('?sort=price_desc');

    await screen.findByText('没有符合条件的意向');
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument();
    expect(searchText()).not.toContain('currency=');
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
    renderTrade('?min=10&max=30');

    await screen.findByText('暂无交易意向');
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清除 价格区间' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /筛选与排序（/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '筛选与排序' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '最低价' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: '最高价' })).toHaveValue('');
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

    await openSort(user);
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(searchText()).toContain('sort=price_asc');
      expect(searchText()).not.toContain('currency=');
    });
    expect(latestInput()).toMatchObject({ sort: 'price_asc', currency: 'CNY' });

    await user.click(screen.getByRole('button', { name: '清除 货币' }));

    await waitFor(() => {
      const search = searchText();
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

  it('drops a price sort default currency when returning to newest', async () => {
    const user = userEvent.setup();
    renderTrade();

    await openSort(user);
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(searchText()).toContain('sort=price_asc');
      expect(searchText()).not.toContain('currency=');
    });
    expect(latestInput()).toMatchObject({ sort: 'price_asc', currency: 'CNY' });

    await openSort(user);
    await user.keyboard('{ArrowUp}{Enter}');

    await waitFor(() => {
      expect(searchText()).not.toContain('sort=');
      expect(searchText()).not.toContain('currency=');
    });
    expect(latestInput()).toMatchObject({
      sort: 'newest',
      currency: undefined,
      minPrice: undefined,
      maxPrice: undefined,
    });
  });

  it('keeps a currency the user picked when returning to newest', async () => {
    const user = userEvent.setup();
    renderTrade();

    await user.click(screen.getByRole('combobox', { name: '货币' }));
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(searchText()).toContain('currency=CNY'));

    await openSort(user);
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(searchText()).toContain('sort=price_asc');
      expect(searchText()).toContain('currency=CNY');
    });

    await openSort(user);
    await user.keyboard('{ArrowUp}{Enter}');

    await waitFor(() => {
      expect(searchText()).not.toContain('sort=');
      expect(searchText()).toContain('currency=CNY');
    });
    expect(latestInput()).toMatchObject({ sort: 'newest', currency: 'CNY' });
  });

  it('removes currency auto-attached by a price range when that range is cleared', async () => {
    const user = userEvent.setup();
    renderTrade();

    await openSort(user);
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(searchText()).toContain('sort=price_asc'));

    await user.type(screen.getByRole('textbox', { name: '最低价' }), '10');
    await user.tab();

    await waitFor(() => {
      expect(searchText()).toContain('currency=CNY');
      expect(searchText()).toContain('min=10');
    });
    expect(latestInput()).toMatchObject({ sort: 'price_asc', currency: 'CNY', minPrice: 10 });

    await user.click(screen.getByRole('button', { name: '清除 价格区间' }));

    await waitFor(() => {
      const search = searchText();
      expect(search).toContain('sort=price_asc');
      expect(search).not.toContain('currency=');
      expect(search).not.toContain('min=');
    });
    expect(latestInput()).toMatchObject({
      sort: 'price_asc',
      currency: 'CNY',
      minPrice: undefined,
      maxPrice: undefined,
    });
  });

  it('keeps a user-selected currency when the price range is cleared', async () => {
    const user = userEvent.setup();
    renderTrade();

    await user.click(screen.getByRole('combobox', { name: '货币' }));
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => expect(searchText()).toContain('currency=USD'));

    await user.type(screen.getByRole('textbox', { name: '最低价' }), '10');
    await user.tab();
    await waitFor(() => expect(searchText()).toContain('min=10'));

    await user.click(screen.getByRole('button', { name: '清除 价格区间' }));

    await waitFor(() => {
      const search = searchText();
      expect(search).toContain('currency=USD');
      expect(search).not.toContain('min=');
      expect(search).not.toContain('sort=');
    });
    expect(latestInput()).toMatchObject({ sort: 'newest', currency: 'USD', minPrice: undefined });
  });

  it('removes a range-attached currency when price sort returns to newest', async () => {
    const user = userEvent.setup();
    renderTrade();

    await openSort(user);
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(searchText()).toContain('sort=price_asc'));

    await user.type(screen.getByRole('textbox', { name: '最低价' }), '10');
    await user.tab();
    await waitFor(() => expect(searchText()).toContain('currency=CNY'));

    await openSort(user);
    await user.keyboard('{ArrowUp}{Enter}');

    await waitFor(() => {
      expect(searchText()).not.toContain('sort=');
      expect(searchText()).not.toContain('currency=');
    });
    expect(latestInput()).toMatchObject({
      sort: 'newest',
      currency: undefined,
    });
  });

  it('falls back to a text link when a listing photo fails to load', async () => {
    listHarness.items = [listingWithPhoto(['https://example.com/broken.png'])];
    renderTrade();

    const img = document.querySelector('img[src="https://example.com/broken.png"]');
    if (!(img instanceof HTMLImageElement)) throw new Error('photo img is missing');
    fireEvent.error(img);

    const fallback = await screen.findByRole('link', { name: '图片 1' });
    expect(fallback).toHaveAttribute('href', 'https://example.com/broken.png');
    expect(document.querySelector('img[src="https://example.com/broken.png"]')).toBeNull();
  });

  it('localizes the load error in English', async () => {
    listHarness.isError = true;
    rootStore.locale.setLocale('en-US');
    renderTrade();

    expect(await screen.findByText('Failed to load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument();
    expect(screen.queryByText('重试')).not.toBeInTheDocument();
  });
});
