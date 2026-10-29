import axe from 'axe-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

const username = 'W'.repeat(24);

const card = {
  slug: 'aurora-knight',
  name: '极光骑士',
  description: '黎明降临。',
  imageUrl: null,
  rarity: 'rare',
  seriesSlug: 'celestial-dawn',
  seriesTitle: '天穹黎明',
  attributes: { Cost: '3' },
};

const collectionQuery: {
  data: { ownedCount: number; wanted: boolean } | null;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: { data?: { appCode?: string; code?: string } } | null;
  errorUpdateCount: number;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: null,
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

const readyQuery = {
  data: [] as unknown[],
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
    cards: {
      bySlug: {
        useQuery: () => ({ ...readyQuery, data: card }),
      },
    },
    listings: {
      byCard: {
        useQuery: () => readyQuery,
      },
    },
    collection: {
      byCard: {
        useQuery: () => collectionQuery,
      },
      upsert: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    comments: {
      listForCard: {
        useQuery: () => ({
          ...readyQuery,
          data: [
            {
              id: 'cm-long',
              content: 'QA单行',
              createdAt: '2026-05-01T08:00:00.000Z',
              user: { id: 'user-w', username },
            },
          ],
        }),
      },
      listForSeries: { useQuery: () => readyQuery },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createForSeries: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }) },
    },
    reports: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { CardDetailPage } from './card-detail';

function renderCard() {
  return render(
    <MemoryRouter initialEntries={['/cards/aurora-knight']}>
      <Routes>
        <Route path="/cards/:cardSlug" element={<CardDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function measure(listLabel: string) {
  const doc = document.documentElement;
  const main = document.querySelector('main');
  if (!main) throw new Error('missing main');
  const nodes = [...main.querySelectorAll<HTMLElement>('*')];
  const boxes = nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      right: Math.round(rect.right * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      tag: node.tagName,
      text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
    };
  });
  const over = boxes.filter((box) => box.right > 375);
  const list = screen.getByRole('list', { name: listLabel });
  const cardEl = list.querySelector('li');
  const header = cardEl?.firstElementChild;
  const name = header?.querySelector('span');
  const time = header?.querySelector('time');
  const report = cardEl?.querySelector('a');
  const rect = (node: Element | null | undefined) => {
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return {
      left: Math.round(box.left * 100) / 100,
      right: Math.round(box.right * 100) / 100,
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
    };
  };
  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    innerWidth: window.innerWidth,
    overflowCount: over.length,
    overflowSample: over.slice(0, 6),
    maxRight: boxes.reduce((max, box) => Math.max(max, box.right), 0),
    card: rect(cardEl),
    header: rect(header),
    name: rect(name),
    time: rect(time),
    report: rect(report),
  };
}

beforeEach(async () => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  collectionQuery.data = null;
  collectionQuery.isLoading = false;
  collectionQuery.isPending = false;
  collectionQuery.isFetching = false;
  collectionQuery.isError = false;
  collectionQuery.isSuccess = true;
  collectionQuery.error = null;
  collectionQuery.errorUpdateCount = 0;
  collectionQuery.dataUpdatedAt = 1;
  await commands.setViewport(375, 900);
});

afterEach(() => {
  cleanup();
});

describe('card detail comment header at 375', () => {
  it.each([
    ['zh-CN', '评论列表', '举报'],
    ['en-US', 'Comments', 'Report'],
  ] as const)(
    'keeps a 24-character username inside the page (%s)',
    async (locale, listLabel, reportName) => {
      rootStore.locale.setLocale(locale);
      renderCard();
      const name = await screen.findByText(`@${username}`);
      expect(name).toHaveAttribute('title', `@${username}`);
      expect(screen.getByRole('link', { name: reportName })).toBeInTheDocument();

      const metrics = measure(listLabel);
      expect(metrics.innerWidth).toBe(375);
      expect(metrics.scrollWidth).toBe(metrics.clientWidth);
      expect(metrics.overflowCount, JSON.stringify(metrics)).toBe(0);
      expect(metrics.maxRight).toBeLessThanOrEqual(375);
      expect(metrics.card?.right ?? Infinity).toBeLessThanOrEqual(359);
      expect(metrics.header?.height).toBe(24);
      expect(metrics.time?.right ?? Infinity).toBeLessThanOrEqual(375);
      expect(metrics.report?.right ?? Infinity).toBeLessThanOrEqual(375);
    },
  );
});

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

describe('card detail WCAG', () => {
  it.each([
    ['zh-CN', 1440],
    ['zh-CN', 375],
    ['en-US', 1440],
    ['en-US', 375],
  ] as const)('has no %s violations at %i px', async (locale, width) => {
    rootStore.locale.setLocale(locale);
    await commands.setViewport(width, 900);
    renderCard();
    expect(await screen.findByRole('heading', { level: 1, name: '极光骑士' })).toBeInTheDocument();

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
  });

  it.each([
    ['zh-CN', 1440],
    ['zh-CN', 375],
    ['en-US', 1440],
    ['en-US', 375],
  ] as const)('has no %s violations with a saved collection at %i px', async (locale, width) => {
    rootStore.locale.setLocale(locale);
    rootStore.session.signIn('token', { id: 'u1', username: 'alice' });
    collectionQuery.data = { ownedCount: 2, wanted: true };
    await commands.setViewport(width, 900);
    renderCard();
    expect(
      await screen.findByRole('button', { pressed: true, name: /我有|I have it/ }),
    ).toBeInTheDocument();

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
  });
});

describe('collection bar layout', () => {
  function box(name: string) {
    return screen.getByRole('button', { name }).getBoundingClientRect();
  }

  it.each([
    ['zh-CN', '我有', '想要', '分享', '数量'],
    ['en-US', 'I have it', 'Want', 'Share', 'Quantity'],
  ] as const)(
    'uses two rows at 375 and one row at 1440 (%s)',
    async (locale, ownName, wantName, shareName, quantityName) => {
      rootStore.locale.setLocale(locale);
      rootStore.session.signIn('token', { id: 'u1', username: 'alice' });
      collectionQuery.data = { ownedCount: 2, wanted: true };
      await commands.setViewport(375, 900);
      const narrow = renderCard();

      const own = box(ownName);
      const want = box(wantName);
      const share = box(shareName);
      const quantity = screen.getByRole('textbox', { name: quantityName }).getBoundingClientRect();
      expect(own.height).toBeGreaterThanOrEqual(40);
      expect(want.height).toBeGreaterThanOrEqual(40);
      expect(share.height).toBeGreaterThanOrEqual(40);
      expect(quantity.height).toBeGreaterThanOrEqual(40);
      expect(Math.abs(own.top - quantity.top)).toBeLessThan(8);
      expect(Math.abs(want.top - share.top)).toBeLessThan(8);
      expect(want.top).toBeGreaterThan(own.top + 20);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );

      narrow.unmount();
      await commands.setViewport(1440, 900);
      renderCard();
      const ownWide = box(ownName);
      const wantWide = box(wantName);
      const shareWide = box(shareName);
      expect(Math.abs(ownWide.top - wantWide.top)).toBeLessThan(8);
      expect(Math.abs(wantWide.top - shareWide.top)).toBeLessThan(8);
      expect(shareWide.left).toBeGreaterThan(wantWide.right);
    },
  );

  it('keeps the signed-out login hint at least 24px tall', async () => {
    await commands.setViewport(375, 900);
    renderCard();
    const link = within(screen.getByRole('region', { name: '我的收藏' })).getByRole('link', {
      name: '登录',
    });
    expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
  });
});
