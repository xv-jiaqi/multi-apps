import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

const { LONG, topic, readyQuery } = vi.hoisted(() => {
  const LONG = `AC14${'W'.repeat(116)}`;
  const readyQuery = {
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
  const topic = {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'ac14-long',
    title: LONG,
    body: '正文用于窄屏。',
    excerpt: '短摘要',
    pinned: false,
    editedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    editableUntil: '2026-05-01T00:05:00.000Z',
    serverNow: '2026-05-01T00:00:00.000Z',
    author: { id: 'user-1', username: 'alice' },
    replyCount: 0,
    replies: [] as [],
    replyNextCursor: null,
  };
  return { LONG, topic, readyQuery };
});

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    useUtils: () => ({
      forum: {
        topics: {
          bySlug: { setData: vi.fn(), invalidate: vi.fn() },
          list: { invalidate: vi.fn() },
        },
        replies: { list: { setInfiniteData: vi.fn(), invalidate: vi.fn(), reset: vi.fn() } },
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
    forum: {
      topics: {
        bySlug: {
          useQuery: () => ({ ...readyQuery, data: topic }),
        },
        list: {
          useInfiniteQuery: () => ({
            data: { pages: [{ items: [topic], nextCursor: null }] },
            isLoading: false,
            isError: false,
            error: null,
            hasNextPage: false,
            isFetchingNextPage: false,
            refetch: vi.fn(),
            fetchNextPage: vi.fn(),
          }),
        },
        delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        setPinned: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      replies: {
        list: {
          useInfiniteQuery: () => ({
            data: undefined,
            isLoading: false,
            isFetching: false,
            isFetchingNextPage: false,
            hasNextPage: false,
            isError: false,
            isFetchNextPageError: false,
            fetchNextPage: vi.fn(),
          }),
        },
        create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
    reports: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { ForumDetailPage } from './forum-detail';
import { ForumListPage } from './forum-list';

function pageStaysInside() {
  const scrolling = document.scrollingElement;
  expect(scrolling).toBeTruthy();
  expect(scrolling!.scrollWidth).toBeLessThanOrEqual(scrolling!.clientWidth);
  const overflowing = [...document.querySelectorAll('main article, main li, main section')].filter(
    (el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible',
  );
  expect(overflowing).toEqual([]);
  expect(document.querySelector('main')?.className ?? '').not.toContain('overflow-x-hidden');
  expect(document.body.className).not.toContain('overflow-x-hidden');
}

beforeEach(async () => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  await commands.setViewport(375, 900);
});

afterEach(() => {
  cleanup();
});

describe('D-AC14-1 topic title at 375px', () => {
  it('wraps the title and the last breadcrumb instead of clipping them', async () => {
    render(
      <MemoryRouter initialEntries={['/forum/ac14-long']}>
        <Routes>
          <Route path="/forum/:slug" element={<ForumDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const title = await screen.findByRole('heading', { level: 3, name: LONG });
    expect(title).toHaveClass('min-w-0', 'wrap-anywhere');
    expect(title.className).not.toMatch(/\btruncate\b|\bbreak-all\b|\bline-clamp-/);

    const crumb = screen.getByText(LONG, { selector: '[aria-current="page"]' });
    expect(crumb).toHaveClass('min-w-0', 'wrap-anywhere', 'text-neutral-900');
    expect(crumb.closest('li')).toHaveClass('min-w-0');

    pageStaysInside();
    expect(window.innerWidth).toBe(375);
    expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(375);
    expect(title.getBoundingClientRect().height).toBeGreaterThan(40);
    expect(crumb.getBoundingClientRect().right).toBeLessThanOrEqual(375);
    expect(title.textContent).toBe(LONG);
  });
});

describe('D-AC14-5 forum list title at 375px', () => {
  it('wraps the topic heading inside the list item and keeps the two-line summary', async () => {
    render(
      <MemoryRouter>
        <ForumListPage />
      </MemoryRouter>,
    );

    const heading = await screen.findByRole('heading', { level: 2, name: LONG });
    expect(heading).toHaveClass('min-w-0', 'wrap-anywhere');
    expect(heading.className).not.toMatch(/\btruncate\b|\bbreak-all\b|\bline-clamp-/);

    const summary = screen.getByText('短摘要');
    expect(summary).toHaveClass('line-clamp-2', 'wrap-anywhere');

    const item = heading.closest('li');
    expect(item).toBeTruthy();
    pageStaysInside();
    expect(window.innerWidth).toBe(375);
    expect(item!.scrollWidth).toBeLessThanOrEqual(item!.clientWidth + 1);
    expect(heading.getBoundingClientRect().right).toBeLessThanOrEqual(375);
    expect(heading.getBoundingClientRect().height).toBeGreaterThan(40);
    expect(item!.textContent).toContain('0 条回帖');
  });
});
