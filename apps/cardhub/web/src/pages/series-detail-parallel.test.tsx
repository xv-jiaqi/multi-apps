import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';

const calls = vi.hoisted(() => ({
  bySlug: [] as unknown[],
  listBySeries: [] as unknown[],
}));

const pendingQuery = {
  data: undefined,
  isLoading: true,
  isPending: true,
  isFetching: true,
  isError: false,
  error: null,
  errorUpdateCount: 0,
  dataUpdatedAt: 0,
  refetch: vi.fn(),
};

vi.mock('../lib/trpc', () => ({
  trpc: {
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
        }),
      },
    },
    series: {
      bySlug: {
        useQuery: (input: unknown) => {
          calls.bySlug.push(input);
          return pendingQuery;
        },
      },
    },
    cards: {
      listBySeries: {
        useQuery: (input: unknown) => {
          calls.listBySeries.push(input);
          return pendingQuery;
        },
      },
    },
    comments: {
      listForCard: { useQuery: () => pendingQuery },
      listForSeries: { useQuery: () => pendingQuery },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createForSeries: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }) },
    },
    reports: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({
      comments: {
        listForCard: { invalidate: vi.fn() },
        listForSeries: { invalidate: vi.fn() },
      },
    }),
  },
}));

import { SeriesDetailPage } from './series-detail';

describe('series detail request order (CH-240)', () => {
  beforeEach(() => {
    rootStore.locale.setLocale('zh-CN');
    rootStore.session.signOut();
    calls.bySlug.length = 0;
    calls.listBySeries.length = 0;
  });

  it('issues listBySeries in the same turn as bySlug, without waiting for it', () => {
    render(
      <MemoryRouter initialEntries={['/series/celestial-dawn']}>
        <Routes>
          <Route path="/series/:seriesSlug" element={<SeriesDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(calls.bySlug).toEqual([{ slug: 'celestial-dawn', includeCards: false }]);
    expect(calls.listBySeries).toHaveLength(1);
    expect(calls.listBySeries[0]).toMatchObject({
      seriesSlug: 'celestial-dawn',
      page: 1,
    });
  });
});
