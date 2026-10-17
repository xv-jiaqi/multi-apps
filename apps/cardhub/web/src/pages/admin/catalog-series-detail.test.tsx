import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../../stores/root-store';

const seriesState = {
  items: [] as Array<Record<string, unknown>>,
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null as unknown,
  refetch: vi.fn(),
};

const cardsState = {
  data: { cards: [] } as { cards: unknown[] } | undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null as unknown,
  refetch: vi.fn(),
};

vi.mock('../../lib/trpc', () => ({
  trpc: {
    admin: {
      series: {
        list: {
          useQuery: () => ({
            data: seriesState.isError ? undefined : { items: seriesState.items },
            isLoading: seriesState.isLoading,
            isError: seriesState.isError,
            isFetching: seriesState.isFetching,
            error: seriesState.error,
            refetch: seriesState.refetch,
          }),
        },
      },
      cards: {
        delete: {
          useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
        },
      },
    },
    series: {
      bySlug: {
        useQuery: () => cardsState,
      },
    },
    search: {
      global: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
      },
    },
    useUtils: () => ({
      admin: { series: { list: { invalidate: vi.fn() } } },
      series: { bySlug: { invalidate: vi.fn() } },
    }),
  },
}));

import { CatalogSeriesDetailPage } from './catalog-series-detail';

const forge = {
  id: 's2',
  slug: 'forge-of-titans',
  title: '泰坦熔炉',
  description: null,
  coverUrl: null,
  cardCount: 2,
  commentCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-02T08:00:00.000Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/catalog/series/forge-of-titans']}>
      <Routes>
        <Route path="/admin/catalog/series/:slug" element={<CatalogSeriesDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  seriesState.items = [forge];
  seriesState.isLoading = false;
  seriesState.isError = false;
  seriesState.isFetching = false;
  cardsState.data = { cards: [] };
  cardsState.isLoading = false;
  cardsState.isError = false;
  cardsState.isFetching = false;
});

describe('catalog series detail title', () => {
  it('puts the series name in the heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '泰坦熔炉 的卡牌' })).toBeInTheDocument();
    expect(screen.queryByText('{series}')).not.toBeInTheDocument();
  });

  it('uses the slug until the series title has loaded', () => {
    seriesState.items = [];
    seriesState.isLoading = true;
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'forge-of-titans 的卡牌' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('{series}')).not.toBeInTheDocument();
  });
});
