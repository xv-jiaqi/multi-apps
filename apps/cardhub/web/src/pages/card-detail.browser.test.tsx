import axe from 'axe-core';
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
});
