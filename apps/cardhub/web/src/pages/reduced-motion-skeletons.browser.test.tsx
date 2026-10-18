import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';

declare module 'vitest/browser' {
  interface BrowserCommands {
    emulateReducedMotion: (reducedMotion: 'reduce' | 'no-preference') => Promise<void>;
  }
}
import { MemoryRouter, Route, Routes } from 'react-router';
import '../styles/globals.css';

const loadingQuery = {
  data: undefined,
  isLoading: true,
  isPending: true,
  isFetching: true,
  isError: false,
  isSuccess: false,
  error: null,
  errorUpdateCount: 0,
  dataUpdatedAt: 0,
  hasNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
};

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      listings: { list: { invalidate: vi.fn() } },
    }),
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isFetching: false,
          isError: false,
          isSuccess: false,
        }),
      },
    },
    cards: {
      bySlug: {
        useQuery: () => ({
          ...loadingQuery,
          isLoading: false,
          isPending: false,
          isFetching: false,
        }),
      },
      search: {
        useQuery: () => ({
          ...loadingQuery,
          isLoading: false,
          isPending: false,
          isFetching: false,
          data: { results: [] },
        }),
      },
    },
    listings: {
      list: {
        useInfiniteQuery: () => loadingQuery,
      },
    },
    series: {
      bySlug: {
        useQuery: () => loadingQuery,
      },
    },
  },
}));

import { SeriesDetailPage } from './series-detail';
import { TradeListPage } from './trade-list';

function animationNames(root: ParentNode) {
  return [...root.querySelectorAll<HTMLElement>('.animate-pulse')].map(
    (node) => getComputedStyle(node).animationName,
  );
}

beforeEach(async () => {
  await commands.emulateReducedMotion('reduce');
});

afterEach(() => {
  cleanup();
});

describe('skeleton motion under prefers-reduced-motion', () => {
  it('sets trade list skeleton animation-name to none', () => {
    render(
      <MemoryRouter initialEntries={['/trade']}>
        <Routes>
          <Route path="/trade" element={<TradeListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    const names = animationNames(document.body);
    expect(names).toEqual(['none', 'none', 'none', 'none']);
  });

  it('sets series detail skeleton animation-name to none', () => {
    render(
      <MemoryRouter initialEntries={['/series/celestial-dawn']}>
        <Routes>
          <Route path="/series/:seriesSlug" element={<SeriesDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    const names = animationNames(document.body);
    expect(names).toEqual(['none', 'none', 'none', 'none', 'none', 'none']);
  });
});
