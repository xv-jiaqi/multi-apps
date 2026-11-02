import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../../stores/root-store';
import '../../styles/globals.css';

declare module 'vitest/browser' {
  interface BrowserCommands {
    setViewport: (width: number, height: number) => Promise<void>;
  }
}

type ReleaseItem = {
  id: string;
  title: string;
  releaseDate: string;
  datePrecision: 'DAY' | 'MONTH';
  region: string | null;
  series: { slug: string; title: string } | null;
  seriesId: string | null;
  categoryId: null;
  category: null;
  note: null;
  sourceUrl: null;
  createdAt: string;
  updatedAt: string;
};

const list: {
  items: ReleaseItem[];
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isFetchNextPageError: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: null;
  errorUpdateCount: number;
  dataUpdatedAt: number;
  fetchNextPage: ReturnType<typeof vi.fn>;
  refetch: ReturnType<typeof vi.fn>;
} = {
  items: [],
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  error: null,
  errorUpdateCount: 0,
  dataUpdatedAt: 1,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
};

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      admin: { releases: { list: { invalidate: vi.fn() } } },
      releases: { list: { invalidate: vi.fn() } },
    }),
    admin: {
      releases: {
        list: {
          useInfiniteQuery: () => ({
            data:
              list.isLoading || (list.isError && list.items.length === 0)
                ? undefined
                : { pages: [{ items: list.items, nextCursor: null }] },
            isLoading: list.isLoading,
            isPending: list.isPending,
            isFetching: list.isFetching,
            isError: list.isError,
            isFetchNextPageError: list.isFetchNextPageError,
            isFetchingNextPage: list.isFetchingNextPage,
            hasNextPage: list.hasNextPage,
            error: list.error,
            errorUpdateCount: list.errorUpdateCount,
            dataUpdatedAt: list.dataUpdatedAt,
            fetchNextPage: list.fetchNextPage,
            refetch: list.refetch,
          }),
        },
        delete: {
          useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
        },
      },
    },
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isFetching: false,
          isError: false,
          isSuccess: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import { AdminReleasesPage } from './releases';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function entry(): ReleaseItem {
  return {
    id: 'r1',
    title: '春季补充包',
    releaseDate: '2026-12-06',
    datePrecision: 'DAY',
    region: 'CN',
    series: { slug: 'celestial-dawn', title: '天穹黎明' },
    seriesId: 'series-1',
    categoryId: null,
    category: null,
    note: null,
    sourceUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/releases']}>
      <Routes>
        <Route path="/admin/releases" element={<AdminReleasesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function tableFrame(name: string): HTMLElement {
  const table = screen.getByRole('table', { name });
  const frame = table.parentElement;
  if (!(frame instanceof HTMLElement)) throw new Error('missing table frame');
  return frame;
}

function showLoading() {
  list.items = [];
  list.isLoading = true;
  list.isPending = true;
  list.isFetching = true;
}

function showRows() {
  list.items = [entry()];
  list.isLoading = false;
  list.isPending = false;
  list.isFetching = false;
}

async function expectNoAxeViolations() {
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: AXE_TAGS },
  });
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target).slice(0, 3),
    })),
  ).toEqual([]);
}

beforeEach(async () => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  list.items = [];
  list.isLoading = false;
  list.isPending = false;
  list.isFetching = false;
  list.isError = false;
  list.isFetchNextPageError = false;
  list.isFetchingNextPage = false;
  list.hasNextPage = false;
  list.error = null;
  list.errorUpdateCount = 0;
  list.dataUpdatedAt = 1;
  await commands.setViewport(375, 900);
});

afterEach(() => {
  cleanup();
});

const loadingCases: Array<{ locale: 'zh-CN' | 'en-US'; caption: string }> = [
  { locale: 'zh-CN', caption: '发售条目' },
  { locale: 'en-US', caption: 'Releases' },
];

const loadedCases: Array<{ locale: 'zh-CN' | 'en-US'; regionName: string; caption: string }> = [
  { locale: 'zh-CN', regionName: '发售条目', caption: '发售条目' },
  { locale: 'en-US', regionName: 'Releases', caption: 'Releases' },
];

const axeCases: Array<{ locale: 'zh-CN' | 'en-US'; state: 'loading' | 'ready'; caption: string }> =
  [
    { locale: 'zh-CN', state: 'loading', caption: '发售条目' },
    { locale: 'en-US', state: 'loading', caption: 'Releases' },
    { locale: 'zh-CN', state: 'ready', caption: '发售条目' },
    { locale: 'en-US', state: 'ready', caption: 'Releases' },
  ];

describe('admin release list at 375', () => {
  it.each(loadingCases)(
    'keeps the $locale loading skeleton from scrolling sideways',
    ({ locale, caption }) => {
      rootStore.locale.setLocale(locale);
      showLoading();
      renderPage();
      const frame = tableFrame(caption);
      expect(frame.getAttribute('role')).toBeNull();
      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth + 1);
      frame.scrollLeft = frame.scrollWidth;
      expect(frame.scrollLeft).toBe(0);
    },
  );

  it.each(loadedCases)(
    'names the scrolling $locale list so it can take focus',
    ({ locale, regionName, caption }) => {
      rootStore.locale.setLocale(locale);
      showRows();
      renderPage();
      const region = screen.getByRole('region', { name: regionName });
      expect(region.tabIndex).toBe(0);
      expect(tableFrame(caption)).toBe(region);
      expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
      region.focus();
      expect(region).toHaveFocus();
    },
  );
});

describe('admin release list axe', () => {
  it.each(axeCases)(
    'has no $locale violations while $state at 375',
    async ({ locale, state, caption }) => {
      rootStore.locale.setLocale(locale);
      if (state === 'loading') showLoading();
      else showRows();
      renderPage();
      expect(screen.getByRole('table', { name: caption })).toBeInTheDocument();
      await expectNoAxeViolations();
    },
  );
});
