import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';

type Gate = {
  reject: (error: Error) => void;
};

const gates: Gate[] = [];

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
      new Promise<never>((_resolve, reject) => {
        gates.push({ reject });
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
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.querySelectorAll('.h-64')).toHaveLength(0);

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
});
