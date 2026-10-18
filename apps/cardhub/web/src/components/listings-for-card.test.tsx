import { useSyncExternalStore, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

const INJECTED = 'QA-INJECTED-xyz';

const bus = vi.hoisted(() => {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    version: () => version,
    emit() {
      version += 1;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

const listing = {
  id: 'listing-1',
  price: '12.00',
  currency: 'CNY',
  kind: 'SELL' as const,
  condition: null,
  language: null,
  variantNote: null,
  contact: 'wechat',
  seller: { id: 'seller-1', username: 'ada' },
};

const listingQuery: {
  data: Array<typeof listing> | undefined;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: { message: string } | null;
  errorUpdateCount: number;
  dataUpdatedAt: number;
  refetch: () => void;
} = {
  data: undefined,
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  error: null,
  errorUpdateCount: 0,
  dataUpdatedAt: 0,
  refetch: vi.fn(),
};

vi.mock('../lib/trpc', () => ({
  trpc: {
    listings: {
      byCard: {
        useQuery: () => useListingQuery(),
      },
    },
    reports: {
      create: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

import { ListingsForCard } from './listings-for-card';

function useListingQuery() {
  useSyncExternalStore(bus.subscribe, bus.version, bus.version);
  return listingQuery;
}

function resetListings() {
  listingQuery.data = undefined;
  listingQuery.isLoading = false;
  listingQuery.isPending = false;
  listingQuery.isFetching = false;
  listingQuery.isError = false;
  listingQuery.error = null;
  listingQuery.errorUpdateCount = 0;
  listingQuery.dataUpdatedAt = 0;
  listingQuery.refetch = vi.fn();
}

function succeedWith(next: Array<typeof listing>) {
  listingQuery.data = next;
  listingQuery.isLoading = false;
  listingQuery.isPending = false;
  listingQuery.isFetching = false;
  listingQuery.isError = false;
  listingQuery.error = null;
  listingQuery.dataUpdatedAt = 2;
  bus.emit();
}

function renderListings(ui: ReactNode = <ListingsForCard cardSlug="aurora-knight" />) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  resetListings();
});

describe('listings for a card', () => {
  it('shows skeletons while loading and not the empty copy', () => {
    listingQuery.isLoading = true;
    listingQuery.isPending = true;
    listingQuery.isFetching = true;
    renderListings();

    expect(screen.queryByText('该卡暂无交易意向')).not.toBeInTheDocument();
    expect(screen.getByText('加载中')).toBeInTheDocument();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /交易意向板/ })).toBeInTheDocument();
  });

  it('shows a fixed alert for a 500 and keeps the footer links', () => {
    listingQuery.isError = true;
    listingQuery.error = { message: INJECTED };
    listingQuery.errorUpdateCount = 1;
    renderListings();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('交易意向加载失败');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(INJECTED);
    expect(screen.queryByText('该卡暂无交易意向')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /交易意向板/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录后即可发布意向' })).toBeInTheDocument();
  });

  it('uses the English listings failure copy', () => {
    rootStore.locale.setLocale('en-US');
    listingQuery.isError = true;
    listingQuery.error = { message: INJECTED };
    listingQuery.errorUpdateCount = 1;
    renderListings();

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load listings");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the empty copy only after a successful empty response', () => {
    listingQuery.data = [];
    listingQuery.dataUpdatedAt = 1;
    renderListings();

    expect(screen.getByText('该卡暂无交易意向')).toBeInTheDocument();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows the list when the request succeeds with rows', () => {
    listingQuery.data = [listing];
    listingQuery.dataUpdatedAt = 1;
    renderListings();

    expect(screen.getByText(/@ada/)).toBeInTheDocument();
    expect(screen.queryByText('该卡暂无交易意向')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('moves focus to the list after a successful retry', async () => {
    const user = userEvent.setup();
    listingQuery.isError = true;
    listingQuery.error = { message: INJECTED };
    listingQuery.errorUpdateCount = 1;
    listingQuery.refetch = () => succeedWith([listing]);
    renderListings();

    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe('UL');
    });
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('moves focus to the empty message after a successful empty retry', async () => {
    const user = userEvent.setup();
    listingQuery.isError = true;
    listingQuery.error = { message: INJECTED };
    listingQuery.errorUpdateCount = 1;
    listingQuery.refetch = () => succeedWith([]);
    renderListings();

    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(document.activeElement).toHaveTextContent('该卡暂无交易意向');
    });
    expect(document.activeElement?.tagName).toBe('P');
  });
});
