import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

type Row = {
  id: string;
  type: string;
  actor: { username: string } | null;
  excerpt: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
  action?: string;
};

const harness = vi.hoisted(() => ({
  mode: 'ready' as 'loading' | 'error' | 'ready',
  count: 3,
  items: [] as Row[],
}));

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
    notifications: {
      unreadCount: {
        useQuery: () => ({
          data: harness.mode === 'loading' ? undefined : { count: harness.count },
          isError: false,
          isLoading: false,
          isPending: false,
          isFetching: false,
          errorUpdateCount: 0,
          dataUpdatedAt: harness.mode === 'loading' ? 0 : 1,
        }),
      },
      list: {
        useInfiniteQuery: () => ({
          data:
            harness.mode === 'ready'
              ? { pages: [{ items: harness.items, nextCursor: null }] }
              : undefined,
          error: harness.mode === 'error' ? { data: { appCode: 'INTERNAL_SERVER_ERROR' } } : null,
          isError: harness.mode === 'error',
          isLoading: harness.mode === 'loading',
          isPending: harness.mode === 'loading',
          isFetching: harness.mode === 'loading',
          isFetchingNextPage: false,
          isFetchNextPageError: false,
          hasNextPage: false,
          errorUpdateCount: harness.mode === 'error' ? 1 : 0,
          dataUpdatedAt: harness.mode === 'ready' ? 1 : 0,
          fetchNextPage: () => Promise.resolve({ isError: false }),
          refetch: () => Promise.resolve({ isError: false }),
        }),
      },
      markRead: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
      markAllRead: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
    },
    useUtils: () => ({
      notifications: {
        list: {
          getInfiniteData: () => undefined,
          setInfiniteData: () => undefined,
        },
        unreadCount: {
          getData: () => undefined,
          setData: () => undefined,
        },
      },
    }),
  },
}));

import { NotificationsPage } from './notifications';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

const sample: Row[] = [
  {
    id: 'n1',
    type: 'TOPIC_REPLY',
    actor: { username: 'ada' },
    excerpt: '回复里写了一段很长的摘要，用来确认窄屏不会把这一行撑出横向滚动。',
    href: '/forum/topic#reply-2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
    readAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'n2',
    type: 'CONTENT_RESOLVED',
    actor: null,
    excerpt: 'removed',
    href: null,
    readAt: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    action: 'REMOVE_TARGET',
  },
];

beforeEach(async () => {
  harness.mode = 'ready';
  harness.count = 3;
  harness.items = sample;
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'u1', username: 'ada', role: 'user' });
  await commands.setViewport(1440, 900);
});

afterEach(() => {
  cleanup();
  rootStore.session.signOut();
  rootStore.locale.setLocale('zh-CN');
});

function renderPage() {
  render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>,
  );
}

async function expectNoViolations() {
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: [...AXE_TAGS] },
  });
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target).slice(0, 3),
    })),
  ).toEqual([]);
}

describe('notifications page WCAG', () => {
  it.each([
    ['ready', 'zh-CN', 1440],
    ['ready', 'zh-CN', 375],
    ['ready', 'en-US', 1440],
    ['ready', 'en-US', 375],
    ['empty', 'zh-CN', 1440],
    ['empty', 'zh-CN', 375],
    ['empty', 'en-US', 1440],
    ['empty', 'en-US', 375],
    ['error', 'zh-CN', 1440],
    ['error', 'zh-CN', 375],
    ['error', 'en-US', 1440],
    ['error', 'en-US', 375],
    ['loading', 'zh-CN', 1440],
    ['loading', 'zh-CN', 375],
    ['loading', 'en-US', 1440],
    ['loading', 'en-US', 375],
  ] as const)('has no %s violations in %s at %i px', async (mode, locale, width) => {
    harness.mode = mode === 'empty' ? 'ready' : mode;
    harness.count = mode === 'empty' ? 0 : 3;
    harness.items = mode === 'empty' ? [] : sample;
    rootStore.locale.setLocale(locale);
    await commands.setViewport(width, 900);
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectNoViolations();
  });
});
