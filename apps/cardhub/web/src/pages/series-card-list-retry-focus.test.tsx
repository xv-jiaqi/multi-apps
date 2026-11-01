import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';

type ListPage = {
  items: Array<{
    id: string;
    slug: string;
    name: string;
    rarity: string | null;
    imageUrl: string | null;
    cardNumber: string | null;
    subsetSlug: string | null;
    attributes: null;
  }>;
  page: number;
  pageSize: number;
  total: number;
  seriesTotal: number;
  sort: 'number';
  attributeLabels: Record<string, never>;
};

type Gate = {
  resolve: (value: ListPage) => void;
  reject: (error: Error) => void;
};

const gates: Gate[] = [];

const listPage: ListPage = {
  items: [
    {
      id: '1',
      slug: 'aurora',
      name: '极光',
      rarity: 'rare',
      imageUrl: null,
      cardNumber: '1',
      subsetSlug: null,
      attributes: null,
    },
  ],
  page: 1,
  pageSize: 60,
  total: 1,
  seriesTotal: 2,
  sort: 'number',
  attributeLabels: {},
};

function listFailure(): Error {
  return Object.assign(new Error('list failed'), {
    data: { code: 'INTERNAL_SERVER_ERROR', appCode: 'INTERNAL_SERVER_ERROR' },
  });
}

function useSeriesListQuery() {
  return useQuery({
    queryKey: ['cards.listBySeries', 'dawn'],
    retry: false,
    queryFn: () =>
      new Promise<ListPage>((resolve, reject) => {
        gates.push({ resolve, reject });
      }),
  });
}

vi.mock('../lib/trpc', () => ({
  trpc: {
    cards: {
      listBySeries: {
        useQuery: () => useSeriesListQuery(),
      },
    },
  },
}));

import { SeriesCardList } from './series-card-list';

function renderList() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/series/dawn']}>
        <Routes>
          <Route
            path="/series/:seriesSlug"
            element={
              <SeriesCardList
                seriesSlug="dawn"
                subsets={[{ slug: 'base', name: '主卡' }]}
                fallbackCardCount={2}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  gates.length = 0;
  rootStore.locale.setLocale('zh-CN');
});

describe('SeriesCardList retry focus', () => {
  it('keeps document.activeElement on the retry button when Enter fails again', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(gates).toHaveLength(1));
    const first = gates[0];
    if (!first) throw new Error('missing first list request');

    act(() => {
      first.reject(listFailure());
    });

    const retry = await screen.findByRole('button', { name: '重试' });
    retry.focus();
    expect(document.activeElement).toBe(retry);

    await user.keyboard('{Enter}');
    await waitFor(() => expect(gates).toHaveLength(2));

    const busy = screen.getByRole('button', { name: '重试中…' });
    expect(busy).toBe(retry);
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.querySelectorAll('.h-64')).toHaveLength(0);
    await user.click(busy);
    expect(gates).toHaveLength(2);

    const second = gates[1];
    if (!second) throw new Error('missing retry request');
    act(() => {
      second.reject(listFailure());
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '重试' })).toBe(retry);
    });
    expect(document.activeElement).toBe(retry);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('leaves focus on another control when the user moved it during the retry', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(gates).toHaveLength(1));
    const first = gates[0];
    if (!first) throw new Error('missing first list request');

    act(() => {
      first.reject(listFailure());
    });

    const retry = await screen.findByRole('button', { name: '重试' });
    retry.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(gates).toHaveLength(2));
    expect(screen.getByRole('button', { name: '重试中…' })).toBe(retry);

    const search = screen.getByRole('searchbox', { name: '搜索本系列' });
    search.focus();
    expect(document.activeElement).toBe(search);

    const second = gates[1];
    if (!second) throw new Error('missing retry request');
    act(() => {
      second.reject(listFailure());
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '重试' })).toBe(retry);
    });
    expect(document.activeElement).toBe(search);
    expect(document.activeElement).not.toBe(retry);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('returns focus to the retry button when it fell to the document during the retry', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(gates).toHaveLength(1));
    const first = gates[0];
    if (!first) throw new Error('missing first list request');

    act(() => {
      first.reject(listFailure());
    });

    const retry = await screen.findByRole('button', { name: '重试' });
    retry.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(gates).toHaveLength(2));

    retry.blur();
    expect(document.activeElement).toBe(document.body);

    const second = gates[1];
    if (!second) throw new Error('missing retry request');
    act(() => {
      second.reject(listFailure());
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '重试' })).toHaveFocus();
    });
    expect(document.activeElement).toBe(retry);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('moves focus to #cards-title after a successful retry', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(gates).toHaveLength(1));
    const first = gates[0];
    if (!first) throw new Error('missing first list request');

    act(() => {
      first.reject(listFailure());
    });

    const retry = await screen.findByRole('button', { name: '重试' });
    retry.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(gates).toHaveLength(2));
    const busy = screen.getByRole('button', { name: '重试中…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    expect(document.querySelectorAll('.h-64')).toHaveLength(0);

    const second = gates[1];
    if (!second) throw new Error('missing retry request');
    act(() => {
      second.resolve(listPage);
    });

    const title = await screen.findByRole('heading', { level: 2, name: '本系列卡牌' });
    await waitFor(() => {
      expect(document.activeElement).toBe(title);
    });
    expect(title).toHaveAttribute('id', 'cards-title');
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('极光')).toBeInTheDocument();
  });

  it('keeps focus on another control when a retry succeeds', async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(gates).toHaveLength(1));
    const first = gates[0];
    if (!first) throw new Error('missing first list request');

    act(() => {
      first.reject(listFailure());
    });

    const retry = await screen.findByRole('button', { name: '重试' });
    retry.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(gates).toHaveLength(2));

    const search = screen.getByRole('searchbox', { name: '搜索本系列' });
    search.focus();

    const second = gates[1];
    if (!second) throw new Error('missing retry request');
    act(() => {
      second.resolve(listPage);
    });

    await screen.findByText('极光');
    expect(document.activeElement).toBe(search);
    expect(document.getElementById('cards-title')).not.toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });
});
