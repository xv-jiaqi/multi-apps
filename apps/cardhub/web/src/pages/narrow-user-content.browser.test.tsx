import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

declare module 'vitest/browser' {
  interface BrowserCommands {
    setViewport: (width: number, height: number) => Promise<void>;
  }
}

const LONG = 'a'.repeat(220);

const ready = {
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  isSuccess: true,
  error: null,
  errorUpdateCount: 0,
  dataUpdatedAt: 1,
  refetch: vi.fn(),
};

const series = {
  slug: 'celestial-dawn',
  title: '天穹黎明',
  description: LONG,
  coverUrl: null,
  cards: [{ slug: 'aurora-knight', name: '极光骑士', rarity: 'rare', imageUrl: null }],
};

const card = {
  slug: 'aurora-knight',
  name: '极光骑士',
  description: LONG,
  imageUrl: null,
  rarity: 'rare',
  seriesSlug: 'celestial-dawn',
  seriesTitle: '天穹黎明',
  attributes: { Cost: '3' },
};

const replyReport = {
  id: 'report-reply',
  targetId: 'reply-1',
  targetType: 'REPLY' as const,
  reason: 'r'.repeat(220),
  status: 'PENDING' as const,
  createdAt: '2026-05-01T00:00:00.000Z',
  resolvedAt: null,
  resolver: null,
  resolution: null,
  reporter: { id: 'u-admin', username: 'admin' },
  target: {
    topicSlug: 'shot-topic',
    topicTitle: '截图话题',
    authorUsername: 'alice',
    excerpt: 'd'.repeat(220),
  },
};

const commentReport = {
  id: 'report-comment',
  targetId: 'comment-1',
  targetType: 'COMMENT' as const,
  reason: 'c'.repeat(220),
  status: 'PENDING' as const,
  createdAt: '2026-05-01T00:00:00.000Z',
  resolvedAt: null,
  resolver: null,
  resolution: null,
  reporter: { id: 'u-admin', username: 'admin' },
  target: {
    cardSlug: 'aurora-knight',
    cardName: '极光骑士',
    seriesSlug: null,
    seriesTitle: null,
    authorUsername: 'alice',
    excerpt: 'e'.repeat(220),
  },
};

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    useUtils: () => ({
      comments: {
        listForCard: { invalidate: vi.fn() },
        listForSeries: { invalidate: vi.fn() },
      },
    }),
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: false,
        }),
      },
    },
    series: {
      bySlug: { useQuery: () => ({ ...ready, data: series }) },
    },
    cards: {
      bySlug: { useQuery: () => ({ ...ready, data: card }) },
    },
    listings: {
      byCard: { useQuery: () => ({ ...ready, data: [] }) },
    },
    collection: {
      byCard: { useQuery: () => ({ ...ready, data: null }) },
      upsert: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    comments: {
      listForCard: { useQuery: () => ({ ...ready, data: [] }) },
      listForSeries: { useQuery: () => ({ ...ready, data: [] }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createForSeries: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }) },
    },
    reports: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: {
        useInfiniteQuery: () => ({
          ...ready,
          data: { pages: [{ items: [replyReport, commentReport], nextCursor: null }] },
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
        }),
      },
      resolve: { useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }) },
    },
  },
}));

import { CardDetailPage } from './card-detail';
import { ReportsListPage } from './reports-list';
import { SeriesDetailPage } from './series-detail';

function expectWrapped(text: string) {
  const element = screen.getByText(text, { selector: 'p', exact: true });
  expect(element).toHaveTextContent(text);
  expect(element).toHaveClass('wrap-anywhere');
  expect(element.className).not.toMatch(/truncate|line-clamp|break-all/);
  expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
  return element;
}

function expectPageFits() {
  const scrolling = document.scrollingElement;
  expect(scrolling).toBeTruthy();
  expect(scrolling!.scrollWidth).toBeLessThanOrEqual(scrolling!.clientWidth);
  const clipped = [...document.querySelectorAll('main article, main li, main section')].filter(
    (el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'visible',
  );
  expect(clipped).toEqual([]);
}

beforeEach(async () => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'u-admin', username: 'admin', role: 'admin' });
  await commands.setViewport(375, 1400);
});

afterEach(() => {
  cleanup();
  rootStore.session.signOut();
});

describe('narrow user content at 375px', () => {
  it('wraps a series description instead of truncating it', () => {
    render(
      <MemoryRouter initialEntries={['/series/celestial-dawn']}>
        <Routes>
          <Route path="/series/:seriesSlug" element={<SeriesDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const description = expectWrapped(LONG);
    expect(description).toHaveClass('min-w-0', 'max-w-2xl', 'text-white/90');
    expectPageFits();
  });

  it('wraps a card description and keeps the grid inside the page', () => {
    render(
      <MemoryRouter initialEntries={['/cards/aurora-knight']}>
        <Routes>
          <Route path="/cards/:cardSlug" element={<CardDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const description = expectWrapped(LONG);
    expect(description).toHaveClass('min-w-0', 'text-neutral-600');
    const grid = description.closest('.grid');
    expect(grid).toBeTruthy();
    expect(grid!.getBoundingClientRect().width).toBeLessThanOrEqual(343);
    expectPageFits();
  });

  it('wraps report reasons and target excerpts', () => {
    render(
      <MemoryRouter>
        <ReportsListPage />
      </MemoryRouter>,
    );
    expectWrapped('r'.repeat(220));
    expectWrapped('d'.repeat(220));
    expectWrapped('c'.repeat(220));
    expectWrapped('e'.repeat(220));
    expectPageFits();
  });
});
