import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { keepPreviousData } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes, useNavigate, useSearchParams } from 'react-router';
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

type GlobalInput = {
  q?: string;
  limit?: number;
  cardLimit?: number;
  seriesLimit?: number;
  cardPage?: number;
};

const harness = vi.hoisted(() => ({
  calls: [] as Array<{
    input: GlobalInput;
    options?: { enabled?: boolean; placeholderData?: unknown };
  }>,
  seriesCalls: [] as Array<{ pageSize?: number } | undefined>,
  mode: 'success' as 'success' | 'empty' | 'error' | 'loading' | 'refreshing',
  includeSeries: true,
  seriesLoading: false,
  /** Overrides `cardTotal`; defaults to the number of cards returned. */
  cardTotal: undefined as number | undefined,
  lastData: undefined as
    | {
        cards: Array<{ slug: string; name: string }>;
        series: Array<{ slug: string; title: string }>;
      }
    | undefined,
  refetch: vi.fn(),
}));

type MockCard = { slug: string; name: string } & Record<string, unknown>;

/** CH-241 contract fields that every `search.global` response carries. */
function paged(
  result: { query: string; cards: MockCard[]; series: Array<{ slug: string; title: string }> },
  input: GlobalInput,
) {
  return {
    ...result,
    cards: result.cards.map((card) => ({
      cardNumber: null,
      subsetSlug: null,
      subsetName: null,
      ...card,
    })),
    cardTotal: harness.cardTotal ?? result.cards.length,
    cardPage: input.cardPage ?? 1,
  };
}

const sampleCards = [
  {
    id: 'c1',
    slug: 'aurora-knight',
    name: '极光骑士',
    rarity: 'legendary',
    imageUrl: 'https://example.com/aurora.png',
    seriesSlug: 'celestial-dawn',
    seriesTitle: '天穹黎明',
    cardNumber: '025',
    subsetSlug: 'ptcg-sc-151',
    subsetName: '151',
  },
  {
    id: 'c2',
    slug: 'glacier-sentinel',
    name: '冰川哨兵',
    rarity: null,
    imageUrl: null,
    seriesSlug: 'celestial-dawn',
    seriesTitle: '天穹黎明',
    cardNumber: 'SV-P-001',
    subsetSlug: 'promo-slug',
    subsetName: null,
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
  if (query.includes('孤儿')) {
    return {
      query,
      cards: [
        {
          id: 'c-orphan',
          slug: 'orphan-y',
          name: '孤儿卡',
          rarity: 'rare',
          imageUrl: null,
          seriesSlug: 'celestial-dawn',
          seriesTitle: '天穹黎明',
          parallelName: '孤儿X',
          printRun: 7,
          isParallel: false,
          base: null,
        },
      ],
      series: [],
    };
  }
  if (query.includes('金箔')) {
    return {
      query,
      cards: [
        {
          id: 'c-foil',
          slug: 'aurora-foil',
          name: '极光骑士',
          rarity: 'rare',
          imageUrl: null,
          seriesSlug: 'celestial-dawn',
          seriesTitle: '天穹黎明',
          parallelName: '金箔超长平行名称金箔超长平行名称金箔超长',
          printRun: 99,
          isParallel: true,
          base: { slug: 'aurora-base', name: '极光骑士' },
        },
        {
          id: 'c-plain',
          slug: 'aurora-plain',
          name: '极光骑士',
          rarity: 'rare',
          imageUrl: null,
          seriesSlug: 'celestial-dawn',
          seriesTitle: '天穹黎明',
          parallelName: null,
          printRun: null,
          isParallel: false,
          base: null,
        },
      ],
      series: [],
    };
  }
  if (query.includes('冰川')) {
    return {
      query,
      cards: [
        {
          id: 'c-ice',
          slug: 'glacier-witch',
          name: '冰川巫女',
          rarity: 'epic',
          imageUrl: null,
          seriesSlug: 'celestial-dawn',
          seriesTitle: '天穹黎明',
        },
      ],
      series: [],
    };
  }
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
            const data = paged({ query: input.q ?? '', cards: [], series: [] }, input);
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
          const data = paged(currentResult(input.q ?? ''), input);
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

function HistoryBack() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      后退
    </button>
  );
}

function HistoryForward() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(1)}>
      前进
    </button>
  );
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
              <Link to="/search?q=冰川">去冰川</Link>
              <HistoryBack />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderSearchHistory(entries: string[], index: number) {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route
          path="/search"
          element={
            <>
              <SearchPage />
              <SearchProbe />
              <HistoryBack />
              <HistoryForward />
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
    harness.cardTotal = undefined;
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
    expect(screen.getByText('传说')).toBeInTheDocument();
    expect(screen.queryByText('普通')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(urlQuery()).toBe('极光');
    expect(screen.getByRole('searchbox', { name: '全站搜索' })).toHaveValue('极光');
    expect(enabledPageCalls().every((call) => call.input.q === '极光')).toBe(true);
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
      screen.getByText(
        '不支持「usd<1」。可用的前缀：r:（稀有度）、s:（系列）、c:（卡号）、y:（发售年）',
      ),
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
      screen.getByText('没有「mythic」这个稀有度，可选 common、rare、epic、legendary'),
    ).toBeInTheDocument();
    expect(screen.queryByText('invalidRarity')).not.toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(enabledPageCalls().some((call) => call.input.q === 'usd<1')).toBe(false);
    expect(enabledPageCalls().some((call) => call.input.q === 'r:mythic')).toBe(false);
  });

  it('follows an external query without writing the previous value back', async () => {
    const user = userEvent.setup();
    renderSearch('?q=极光');

    expect(screen.getByRole('searchbox', { name: '全站搜索' })).toHaveValue('极光');
    expect(await screen.findByText('极光骑士')).toBeInTheDocument();
    const beforeNavigation = enabledPageCalls().length;

    await user.click(screen.getByRole('link', { name: '去冰川' }));

    expect(screen.getByRole('searchbox', { name: '全站搜索' })).toHaveValue('冰川');
    expect(await screen.findByText('冰川巫女')).toBeInTheDocument();
    expect(screen.queryByText('极光骑士')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(urlQuery()).toBe('冰川');
    expect(screen.getByRole('searchbox', { name: '全站搜索' })).toHaveValue('冰川');
    const navigatedCalls = enabledPageCalls().slice(beforeNavigation);
    expect(navigatedCalls.length).toBeGreaterThan(0);
    expect(navigatedCalls.every((call) => call.input.q === '冰川')).toBe(true);
  });

  it('follows browser back and forward without rewriting q', async () => {
    const user = userEvent.setup();
    renderSearchHistory(['/search?q=极光', '/search?q=冰川'], 1);

    expect(screen.getByRole('searchbox', { name: '全站搜索' })).toHaveValue('冰川');
    expect(await screen.findByText('冰川巫女')).toBeInTheDocument();
    const beforeBack = enabledPageCalls().length;

    await user.click(screen.getByRole('button', { name: '后退' }));

    expect(screen.getByRole('searchbox', { name: '全站搜索' })).toHaveValue('极光');
    expect(await screen.findByText('极光骑士')).toBeInTheDocument();
    expect(screen.queryByText('冰川巫女')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(urlQuery()).toBe('极光');
    expect(screen.getByRole('searchbox', { name: '全站搜索' })).toHaveValue('极光');
    const backCalls = enabledPageCalls().slice(beforeBack);
    expect(backCalls.length).toBeGreaterThan(0);
    expect(backCalls.every((call) => call.input.q === '极光')).toBe(true);

    const beforeForward = enabledPageCalls().length;
    await user.click(screen.getByRole('button', { name: '前进' }));

    expect(screen.getByRole('searchbox', { name: '全站搜索' })).toHaveValue('冰川');
    expect(await screen.findByText('冰川巫女')).toBeInTheDocument();
    expect(screen.queryByText('极光骑士')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(urlQuery()).toBe('冰川');
    expect(screen.getByRole('searchbox', { name: '全站搜索' })).toHaveValue('冰川');
    const forwardCalls = enabledPageCalls().slice(beforeForward);
    expect(forwardCalls.length).toBeGreaterThan(0);
    expect(forwardCalls.every((call) => call.input.q === '冰川')).toBe(true);
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

    const pulse = document.querySelector('.animate-pulse');
    expect(pulse).toBeTruthy();
    expect(pulse?.parentElement).toHaveClass('min-h-svh');
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
    expect(document.getElementById('search-syntax')).toHaveTextContent(
      'r: 稀有度，s: 系列，c: 卡号，y: 发售年，OR 表示或者，- 表示排除。像 025、25-07 这样的数字卡号可以直接输入，字母卡号请用 c:。',
    );

    // CH-241 §4: real Pokémon examples, in this order, each at least 24px tall.
    const examples = ['皮卡丘', '025', 'c:025 s:ptcg-sc-151', '皮卡丘 OR 喷火龙', 'ex -皮卡丘'];
    for (const example of examples) {
      expect(screen.getByRole('button', { name: `用「${example}」搜索` })).toHaveClass(
        'min-h-6',
        'wrap-anywhere',
      );
    }
    expect(screen.queryByRole('button', { name: '用「r:legendary」搜索' })).not.toBeInTheDocument();

    input.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: '用「皮卡丘」搜索' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('皮卡丘');
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
    harness.cardTotal = undefined;
    harness.lastData = undefined;
    rootStore.locale.setLocale('zh-CN');
  });

  it('shows a parallel badge and a limited total, and skips unnumbered on the tile', async () => {
    const longName = '金箔超长平行名称金箔超长平行名称金箔超长';
    renderSearch('?q=金箔');
    const badge = await screen.findByTitle(longName);
    expect(badge).toHaveTextContent(`平行 · ${longName}`);
    expect(badge.className).toContain('truncate');
    expect(badge).toHaveClass('max-w-full');
    expect(badge.querySelector('span')).toHaveClass('min-w-0', 'truncate');
    const limitedNumber = screen.getByText('/99');
    expect(limitedNumber).toHaveClass('font-mono', 'tabular-nums');
    expect(limitedNumber.previousSibling?.textContent?.endsWith(' ')).toBe(true);
    expect(`${limitedNumber.previousSibling?.textContent ?? ''}${limitedNumber.textContent}`).toBe(
      '限量 /99',
    );
    expect(screen.queryByText('不编号')).not.toBeInTheDocument();
  });

  it('shows an orphan parallel as a base card with only the print run', async () => {
    renderSearch('?q=孤儿X');
    expect(await screen.findByRole('link', { name: /孤儿卡/ })).toBeInTheDocument();
    expect(screen.queryByText(/平行/)).not.toBeInTheDocument();
    expect(screen.getByText(/限量/)).toHaveTextContent('限量 /7');
  });

  it('keeps the series list inside its labelled section', async () => {
    renderSearch('?q=极光');
    const section = await screen.findByRole('region', { name: '系列（1）' });
    expect(within(section).getByRole('link', { name: /天穹黎明/ })).toBeInTheDocument();
  });
});

describe('SearchPage pages and totals (CH-241)', () => {
  beforeEach(() => {
    harness.calls.length = 0;
    harness.mode = 'success';
    harness.includeSeries = true;
    harness.cardTotal = undefined;
    harness.lastData = undefined;
    rootStore.locale.setLocale('zh-CN');
  });

  function pageParam() {
    return new URLSearchParams(screen.getByLabelText('search').textContent ?? '').get('page');
  }

  it('counts with cardTotal and pages with numbers above and below the list (§1)', async () => {
    const user = userEvent.setup();
    harness.cardTotal = 41;
    renderSearch('?q=极光');

    const heading = await screen.findByRole('heading', { name: '卡牌（41）' });
    expect(heading).toHaveAttribute('id', 'sr-cards');
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveClass('scroll-mt-20');
    expect(screen.getByText('找到 41 张卡牌、1 个系列')).toHaveAttribute('role', 'status');
    expect(enabledPageCalls().at(-1)?.input).toMatchObject({ q: '极光', limit: 30, cardPage: 1 });

    const top = screen.getByRole('navigation', { name: '顶部分页' });
    const bottom = screen.getByRole('navigation', { name: '底部分页' });
    expect(heading.compareDocumentPosition(top) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const list = screen.getByRole('region', { name: '卡牌（41）' }).querySelector('ul');
    if (!list) throw new Error('no result list');
    expect(list).not.toHaveAttribute('aria-busy');
    expect(top.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(top).getByText('1').closest('[aria-current="page"]')).toHaveClass(
      'bg-brand-600',
      'text-white',
    );
    expect(within(top).getByText('上一页').closest('[aria-disabled="true"]')).not.toBeNull();
    const pageTwo = within(bottom).getByRole('link', { name: '第 2 页' });
    expect(new URL(pageTwo.getAttribute('href') ?? '', 'http://x').searchParams.get('page')).toBe(
      '2',
    );
    expect(within(top).getByRole('link', { name: '第 1 页' }).getAttribute('href')).not.toContain(
      'page=',
    );

    await user.click(pageTwo);
    expect(pageParam()).toBe('2');
    expect(enabledPageCalls().at(-1)?.input).toMatchObject({ q: '极光', cardPage: 2 });
    await waitFor(() => expect(screen.getByRole('heading', { name: '卡牌（41）' })).toHaveFocus());

    // A page click is a history entry.
    await user.click(screen.getByRole('button', { name: '后退' }));
    expect(pageParam()).toBeNull();
  });

  it('shows the top pagination only from sm, in the heading row, and keeps the bottom one at every width (§1 v1.3)', async () => {
    harness.cardTotal = 157;
    renderSearch('?q=极光');
    const heading = await screen.findByRole('heading', { name: '卡牌（157）' });
    const top = screen.getByRole('navigation', { name: '顶部分页' });
    const bottom = screen.getByRole('navigation', { name: '底部分页' });
    // <sm: display none, so a narrow heading row never wraps (§6 0px).
    expect(top).toHaveClass('hidden', 'sm:flex', '-my-0.5');
    expect(top).not.toHaveClass('flex');
    expect(top.parentElement).toBe(heading.parentElement);
    expect(bottom).not.toHaveClass('hidden');
    expect(bottom).toHaveClass('flex');
  });

  it('renders the series section on page 1 only, with no placeholder on page 2 (§1 v1.3)', async () => {
    const user = userEvent.setup();
    harness.cardTotal = 41;
    renderSearch('?q=极光');
    expect(await screen.findByRole('region', { name: '系列（1）' })).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('navigation', { name: '底部分页' })).getByRole('link', {
        name: '第 2 页',
      }),
    );
    expect(pageParam()).toBe('2');
    await screen.findByRole('heading', { name: '卡牌（41）' });
    expect(screen.queryByRole('region', { name: '系列（1）' })).not.toBeInTheDocument();
    expect(document.getElementById('sr-series')).toBeNull();
    const cards = screen.getByRole('region', { name: '卡牌（41）' });
    expect(cards.previousElementSibling).toBeNull();

    await user.click(screen.getByRole('button', { name: '后退' }));
    expect(await screen.findByRole('region', { name: '系列（1）' })).toBeInTheDocument();
  });

  it('does not render the series section when opened directly on page 2', async () => {
    harness.cardTotal = 41;
    renderSearch('?q=极光&page=2');
    await screen.findByRole('heading', { name: '卡牌（41）' });
    expect(screen.queryByRole('heading', { name: '系列（1）' })).not.toBeInTheDocument();
  });

  it('removes an invalid page', async () => {
    harness.cardTotal = 41;
    renderSearch('?q=极光&page=abc');
    await waitFor(() => expect(pageParam()).toBeNull());
    expect(urlQuery()).toBe('极光');
    expect(enabledPageCalls().every((call) => call.input.cardPage === 1)).toBe(true);
  });

  it('drops an explicit page=1', async () => {
    harness.cardTotal = 41;
    renderSearch('?q=极光&page=1');
    await waitFor(() => expect(pageParam()).toBeNull());
  });

  it('never requests a page above 10000', async () => {
    harness.cardTotal = 41;
    renderSearch('?q=极光&page=10001');
    await waitFor(() => expect(pageParam()).toBeNull());
    expect(enabledPageCalls().some((call) => (call.input.cardPage ?? 1) > 10_000)).toBe(false);
  });

  it('replaces a page past the end with the last page', async () => {
    harness.cardTotal = 41;
    renderSearch('?q=极光&page=9');
    await waitFor(() => expect(pageParam()).toBe('2'));
    expect(enabledPageCalls().at(-1)?.input).toMatchObject({ cardPage: 2 });
  });

  it('starts a new query on page 1 and drops page from the URL', async () => {
    const user = userEvent.setup();
    harness.cardTotal = 41;
    renderSearch('?q=极光&page=2');
    await screen.findByRole('heading', { name: '卡牌（41）' });
    const input = screen.getByRole('searchbox', { name: '全站搜索' });
    await user.clear(input);
    await user.type(input, '冰川');
    await waitFor(() => expect(urlQuery()).toBe('冰川'));
    expect(pageParam()).toBeNull();
    expect(enabledPageCalls().at(-1)?.input).toMatchObject({ q: '冰川', cardPage: 1 });
  });

  it('shows one row per card with the number and subset line, never merging same names (§2)', async () => {
    renderSearch('?q=极光');
    const line = await screen.findByText('#025 · 151');
    expect(line).toHaveClass('font-mono', 'text-xs', 'tabular-nums', 'text-neutral-600');
    expect(line).toHaveClass('wrap-anywhere');
    expect(screen.getByText('#SV-P-001 · promo-slug')).toBeInTheDocument();
    const name = screen.getByText('极光骑士', { selector: 'span' });
    expect(name).toHaveClass('text-sm', 'font-semibold', 'text-neutral-900', 'wrap-anywhere');
    expect(name).not.toHaveClass('truncate');
    expect(name.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps two cards with the same name as two rows', async () => {
    renderSearch('?q=金箔');
    const rows = await screen.findAllByRole('link', { name: /极光骑士/ });
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/cards/aurora-foil',
      '/cards/aurora-plain',
    ]);
  });

  it('adds the c: hint to the empty state (§3)', async () => {
    harness.mode = 'empty';
    renderSearch('?q=025');
    expect(await screen.findByText('没有找到匹配的卡牌或系列')).toBeInTheDocument();
    expect(
      screen.getByText('搜卡号可以直接输入 025 或 25-07。字母卡号请用 c:，例如 c:B。'),
    ).toHaveClass('text-sm', 'text-neutral-600');
  });

  it('reserves the 40px title slot while loading, with no number or pagination (§6)', () => {
    harness.mode = 'loading';
    renderSearch('?q=极光');
    const slot = document.querySelector('.h-7.animate-pulse');
    expect(slot).toHaveAttribute('aria-hidden');
    expect(slot).toHaveClass('rounded-sm', 'bg-neutral-200', 'motion-reduce:animate-none');
    expect(slot?.parentElement).toHaveClass('space-y-3', 'min-h-svh');
    expect(slot?.nextElementSibling?.querySelectorAll('li')).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: /卡牌/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '顶部分页' })).not.toBeInTheDocument();
  });

  it('keeps the previous page on screen and marks the list busy while paging', async () => {
    harness.mode = 'refreshing';
    harness.cardTotal = 41;
    renderSearch('?q=极光');
    await screen.findByRole('heading', { name: '卡牌（41）' });
    const region = screen.getByRole('region', { name: '卡牌（41）' });
    expect(region.querySelector('ul')).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('.h-7.animate-pulse')).toBeNull();
  });

  it('shows the error as an alert before any skeleton and retries', async () => {
    const user = userEvent.setup();
    harness.mode = 'error';
    renderSearch('?q=极光');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('搜索失败');
    expect(document.querySelector('.animate-pulse')).toBeNull();
    await user.click(within(alert).getByRole('button', { name: '重试' }));
    expect(harness.refetch).toHaveBeenCalled();
  });

  it('uses the English copy', async () => {
    rootStore.locale.setLocale('en-US');
    harness.cardTotal = 41;
    renderSearch('?q=极光');
    expect(await screen.findByRole('heading', { name: 'Cards (41)' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Top pagination' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Bottom pagination' })).toBeInTheDocument();
  });
});
