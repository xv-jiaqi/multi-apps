import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { keepPreviousData } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router';
import { rootStore } from '../stores/root-store';
import { SearchPage } from './search';

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = vi.fn();
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}
if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

type GlobalInput = { q?: string; limit?: number; cardLimit?: number; seriesLimit?: number };

const harness = vi.hoisted(() => ({
  calls: [] as Array<{
    input: GlobalInput;
    options?: { enabled?: boolean; placeholderData?: unknown };
  }>,
  seriesCalls: [] as Array<{ pageSize?: number } | undefined>,
  mode: 'success' as 'success' | 'empty' | 'error' | 'loading' | 'refreshing',
  includeSeries: true,
  seriesLoading: false,
  lastData: undefined as
    | {
        cards: Array<{ slug: string; name: string }>;
        series: Array<{ slug: string; title: string }>;
      }
    | undefined,
  refetch: vi.fn(),
}));

const sampleCards = [
  {
    id: 'c1',
    slug: 'aurora-knight',
    name: '极光骑士',
    rarity: 'legendary',
    imageUrl: 'https://example.com/aurora.png',
    seriesSlug: 'celestial-dawn',
    seriesTitle: '天穹黎明',
  },
  {
    id: 'c2',
    slug: 'glacier-sentinel',
    name: '冰川哨兵',
    rarity: 'rare',
    imageUrl: null,
    seriesSlug: 'celestial-dawn',
    seriesTitle: '天穹黎明',
  },
];

const sampleSeries = [
  {
    id: 's1',
    slug: 'celestial-dawn',
    title: '天穹黎明',
    description: '黎明',
    coverUrl: 'https://example.com/cover.png',
    cardCount: 12,
  },
];

function currentResult(query: string) {
  return {
    query,
    cards: sampleCards,
    series: harness.includeSeries ? sampleSeries : [],
  };
}

vi.mock('../lib/trpc', () => ({
  trpc: {
    search: {
      global: {
        useQuery: (
          input: GlobalInput,
          options?: { enabled?: boolean; placeholderData?: unknown },
        ) => {
          harness.calls.push({ input, options });
          const enabled = Boolean(options?.enabled);
          if (!enabled) {
            return {
              data: harness.lastData,
              isLoading: false,
              isFetching: false,
              isError: false,
              isSuccess: Boolean(harness.lastData),
              isPlaceholderData: false,
              error: null,
              refetch: harness.refetch,
            };
          }
          if (harness.mode === 'loading') {
            return {
              data: undefined,
              isLoading: true,
              isFetching: true,
              isError: false,
              isSuccess: false,
              isPlaceholderData: false,
              error: null,
              refetch: harness.refetch,
            };
          }
          if (harness.mode === 'error') {
            return {
              data: undefined,
              isLoading: false,
              isFetching: false,
              isError: true,
              isSuccess: false,
              isPlaceholderData: false,
              error: { message: 'database exploded' },
              refetch: harness.refetch,
            };
          }
          if (harness.mode === 'empty') {
            const data = { query: input.q ?? '', cards: [], series: [] };
            harness.lastData = data;
            return {
              data,
              isLoading: false,
              isFetching: false,
              isError: false,
              isSuccess: true,
              isPlaceholderData: false,
              error: null,
              refetch: harness.refetch,
            };
          }
          const data = currentResult(input.q ?? '');
          harness.lastData = data;
          if (harness.mode === 'refreshing') {
            return {
              data,
              isLoading: false,
              isFetching: true,
              isError: false,
              isSuccess: true,
              isPlaceholderData: true,
              error: null,
              refetch: harness.refetch,
            };
          }
          return {
            data,
            isLoading: false,
            isFetching: false,
            isError: false,
            isSuccess: true,
            isPlaceholderData: false,
            error: null,
            refetch: harness.refetch,
          };
        },
      },
    },
    series: {
      list: {
        useQuery: (input?: { pageSize?: number }) => {
          harness.seriesCalls.push(input);
          if (harness.seriesLoading) {
            return { data: undefined, isLoading: true, isError: false };
          }
          return {
            data: {
              items: [
                {
                  id: 'z',
                  slug: 'zeta-set',
                  title: 'Zeta',
                  cardCount: 1,
                  coverUrl: null,
                  description: '',
                  createdAt: '',
                  updatedAt: '',
                },
                {
                  id: 's',
                  slug: 'celestial-dawn',
                  title: '天穹黎明',
                  cardCount: 12,
                  coverUrl: null,
                  description: '',
                  createdAt: '',
                  updatedAt: '',
                },
                {
                  id: 'a',
                  slug: 'alpha-set',
                  title: 'Alpha',
                  cardCount: 2,
                  coverUrl: null,
                  description: '',
                  createdAt: '',
                  updatedAt: '',
                },
              ],
              page: 1,
              pageSize: input?.pageSize ?? 20,
              total: 3,
            },
            isLoading: false,
            isError: false,
          };
        },
      },
    },
  },
}));

function SearchProbe() {
  const [params] = useSearchParams();
  return <output aria-label="search">{params.toString()}</output>;
}

function renderSearch(search = '') {
  render(
    <MemoryRouter initialEntries={[`/search${search}`]}>
      <Routes>
        <Route
          path="/search"
          element={
            <>
              <SearchPage />
              <SearchProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function pageCalls() {
  return harness.calls.filter((call) => call.input.limit === 30);
}

function enabledPageCalls() {
  return pageCalls().filter((call) => call.options?.enabled);
}

function urlQuery() {
  return new URLSearchParams(screen.getByLabelText('search').textContent ?? '').get('q');
}

describe('SearchPage', () => {
  beforeEach(() => {
    harness.calls.length = 0;
    harness.seriesCalls.length = 0;
    harness.mode = 'success';
    harness.includeSeries = true;
    harness.seriesLoading = false;
    harness.lastData = undefined;
    harness.refetch.mockReset();
    rootStore.locale.setLocale('zh-CN');
  });

  it('reads q from the URL and shows series before cards', async () => {
    renderSearch('?q=极光');

    expect(screen.getByRole('searchbox', { name: '全站搜索' })).toHaveValue('极光');
    const seriesHeading = await screen.findByRole('heading', { name: '系列（1）' });
    const cardsHeading = screen.getByRole('heading', { name: '卡牌（2）' });
    expect(
      seriesHeading.compareDocumentPosition(cardsHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /极光骑士/ })).toHaveAttribute(
      'href',
      '/cards/aurora-knight',
    );
    expect(screen.getByRole('link', { name: /收录 12/ })).toHaveAttribute(
      'href',
      '/series/celestial-dawn',
    );
    expect(screen.getByText('找到 2 张卡牌、1 个系列')).toBeInTheDocument();
    expect(enabledPageCalls().some((call) => call.input.q === '极光')).toBe(true);
    expect(pageCalls().some((call) => call.options?.placeholderData === keepPreviousData)).toBe(
      true,
    );
    expect(harness.seriesCalls).toContainEqual({ pageSize: 100 });
  });

  it('does not request empty, incomplete, or condition-less queries', async () => {
    const user = userEvent.setup();
    renderSearch();

    expect(screen.getByText('输入卡牌或系列名称开始搜索')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(enabledPageCalls()).toHaveLength(0);

    const input = screen.getByRole('searchbox', { name: '全站搜索' });
    await user.type(input, 'r:');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(enabledPageCalls()).toHaveLength(0);

    await user.clear(input);
    await user.type(input, 'OR');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(enabledPageCalls()).toHaveLength(0);
  });

  it('shows a translated parse error and does not send the query', async () => {
    const user = userEvent.setup();
    renderSearch('?q=极光');
    await screen.findByRole('heading', { name: '系列（1）' });

    const input = screen.getByRole('searchbox', { name: '全站搜索' });
    await user.clear(input);
    await user.type(input, 'usd<1');

    expect(
      screen.getByText('不支持「usd<1」。可用的前缀：r:（稀有度）、s:（系列）'),
    ).toBeInTheDocument();
    expect(screen.queryByText('unknownPrefix')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-describedby', 'search-syntax search-hint');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(
      screen.getByRole('heading', { name: '系列（1）' }).closest('.opacity-60'),
    ).not.toBeNull();

    await user.clear(input);
    await user.type(input, 'r:mythic');
    expect(
      screen.getByText('没有「r:mythic」这个稀有度，可选 common、rare、epic、legendary'),
    ).toBeInTheDocument();
    expect(screen.queryByText('invalidRarity')).not.toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(enabledPageCalls().some((call) => call.input.q === 'usd<1')).toBe(false);
    expect(enabledPageCalls().some((call) => call.input.q === 'r:mythic')).toBe(false);
  });

  it('writes the debounced query to the URL and keeps previous results while refreshing', async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.type(screen.getByRole('searchbox', { name: '全站搜索' }), '极光');
    await waitFor(() => {
      expect(urlQuery()).toBe('极光');
    });
    expect(
      enabledPageCalls().some((call) => call.input.q === '极光' && call.input.limit === 30),
    ).toBe(true);
  });

  it('keeps previous results on screen and announces that a refresh is in progress', async () => {
    harness.mode = 'refreshing';
    renderSearch('?q=极光');

    expect(await screen.findByText('极光骑士')).toBeInTheDocument();
    expect(screen.getByText('搜索中…')).toBeInTheDocument();
  });

  it('shows an empty state with clear filters, and a retryable error without the raw message', async () => {
    harness.mode = 'empty';
    renderSearch('?q=r%3Alegendary');

    expect(await screen.findByText('没有找到匹配的卡牌或系列')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '清除筛选' }).length).toBeGreaterThan(0);
  });

  it('shows a retryable search failure without the raw error message', async () => {
    const user = userEvent.setup();
    harness.mode = 'error';
    renderSearch('?q=极光');

    expect(await screen.findByText('搜索失败')).toBeInTheDocument();
    expect(screen.queryByText('database exploded')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(harness.refetch).toHaveBeenCalled();
  });

  it('shows a skeleton on the first load', () => {
    harness.mode = 'loading';
    renderSearch('?q=极光');

    expect(document.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('极光骑士')).not.toBeInTheDocument();
  });

  it('syncs rarity and series selects with q, and clears only those filters', async () => {
    const user = userEvent.setup();
    renderSearch('?q=r%3Aepic%20%E9%BE%99');

    const input = screen.getByRole('searchbox', { name: '全站搜索' });
    expect(input).toHaveValue('r:epic 龙');
    expect(screen.getByLabelText('稀有度')).toHaveTextContent('史诗');

    await user.click(screen.getByLabelText('稀有度'));
    await user.click(await screen.findByRole('option', { name: '传说' }));
    expect(input).toHaveValue('龙 r:legendary');
    await waitFor(() => {
      expect(urlQuery()).toBe('龙 r:legendary');
    });

    await user.clear(input);
    await user.type(input, 'r:rare r:epic 龙');
    await waitFor(() => expect(screen.getByLabelText('稀有度')).toHaveTextContent('稀有'));

    await user.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(input).toHaveValue('龙');

    await user.clear(input);
    await user.type(input, 's:celestial-dawn 极光');
    await waitFor(() => expect(screen.getByLabelText('系列')).toHaveTextContent('天穹黎明'));

    await user.click(screen.getByLabelText('系列'));
    const options = await screen.findAllByRole('option');
    const names = options.map((option) => option.textContent);
    expect(names[0]).toBe('不限');
    expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('Zeta'));
    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(input).toHaveValue('极光 s:alpha-set');
  });

  it('replaces the query from a syntax example and exposes the syntax to assistive tech', async () => {
    const user = userEvent.setup();
    renderSearch();

    const input = screen.getByRole('searchbox', { name: '全站搜索' });
    expect(input).toHaveAttribute('aria-describedby', 'search-syntax');
    expect(document.getElementById('search-syntax')).toHaveTextContent('r: 按稀有度');

    input.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: '用「r:legendary」搜索' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('r:legendary');
  });

  it('disables the series select while the series list is loading', () => {
    harness.seriesLoading = true;
    renderSearch();
    expect(screen.getByLabelText('系列')).toBeDisabled();
  });
});

describe('SearchPage result links', () => {
  beforeEach(() => {
    harness.calls.length = 0;
    harness.mode = 'success';
    harness.lastData = undefined;
    rootStore.locale.setLocale('zh-CN');
  });

  it('keeps the series list inside its labelled section', async () => {
    renderSearch('?q=极光');
    const section = await screen.findByRole('region', { name: '系列（1）' });
    expect(within(section).getByRole('link', { name: /天穹黎明/ })).toBeInTheDocument();
  });
});
