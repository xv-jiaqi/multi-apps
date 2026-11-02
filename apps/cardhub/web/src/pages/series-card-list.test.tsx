import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { rootStore } from '../stores/root-store';
import { SeriesCardList } from './series-card-list';

const harness = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  whenParallels: undefined as
    | {
        items: Array<Record<string, unknown>>;
        page: number;
        pageSize: number;
        total: number;
        seriesTotal?: number;
        parallelCount?: number;
        sort: 'number';
        attributeLabels: Record<string, { 'zh-CN': string; 'en-US': string }>;
      }
    | undefined,
  state: {
    data: undefined as
      | {
          items: Array<{
            id: string;
            slug: string;
            name: string;
            rarity: string | null;
            imageUrl: string | null;
            cardNumber: string | null;
            subsetSlug: string | null;
            attributes: Record<string, string | number> | null;
          }>;
          page: number;
          pageSize: number;
          total: number;
          seriesTotal?: number;
          parallelCount?: number;
          sort: 'number';
          attributeLabels: Record<string, { 'zh-CN': string; 'en-US': string }>;
        }
      | undefined,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null as { data?: { code?: string; appCode?: string } } | null,
    refetch: vi.fn(),
  },
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    cards: {
      listBySeries: {
        useQuery: (input: Record<string, unknown>) => {
          harness.calls.push(input);
          if (input.includeParallels === true && harness.whenParallels) {
            return { ...harness.state, data: harness.whenParallels };
          }
          return harness.state;
        },
      },
    },
  },
}));

const labels = {
  cost: { 'zh-CN': '费用', 'en-US': 'Cost' },
  attack: { 'zh-CN': '攻击', 'en-US': 'Attack' },
  health: { 'zh-CN': '生命', 'en-US': 'Health' },
  type: { 'zh-CN': '类型', 'en-US': 'Type' },
};

function card(
  name: string,
  number: string | null,
  attributes: Record<string, number> | null = null,
) {
  return {
    id: name,
    slug: name,
    name,
    rarity: 'rare',
    imageUrl: null,
    cardNumber: number,
    subsetSlug: null,
    attributes,
  };
}

function HistoryButtons() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        后退
      </button>
      <button type="button" onClick={() => navigate(1)}>
        前进
      </button>
    </>
  );
}

function renderList(search = '', options?: { entries?: string[]; index?: number; count?: number }) {
  const entries = options?.entries ?? [`/series/dawn${search}`];
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={options?.index}>
      <Routes>
        <Route
          path="/series/:seriesSlug"
          element={
            <>
              <SeriesCardList
                seriesSlug="dawn"
                subsets={[{ slug: 'base', name: '主卡' }]}
                fallbackCardCount={options?.count ?? 2}
              />
              <HistoryButtons />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  harness.calls.length = 0;
  harness.whenParallels = undefined;
  harness.state.data = {
    items: [card('极光', '007', { attack: 2, cost: 1 })],
    page: 1,
    pageSize: 60,
    total: 1,
    seriesTotal: 2,
    sort: 'number',
    attributeLabels: labels,
  };
  harness.state.isLoading = false;
  harness.state.isPending = false;
  harness.state.isFetching = false;
  harness.state.isError = false;
  harness.state.error = null;
  harness.state.refetch = vi.fn();
  rootStore.locale.setLocale('zh-CN');
});

describe('SeriesCardList', () => {
  it('shows the unfiltered series total and a localized attribute line', () => {
    renderList();
    expect(screen.getAllByRole('status').some((node) => node.textContent === '共 2 张')).toBe(true);
    expect(screen.getByText('费用 1 · 攻击 2')).toBeInTheDocument();
    expect(screen.getByText('#007')).toBeInTheDocument();
    expect(harness.calls[0]).toMatchObject({ seriesSlug: 'dawn', page: 1, pageSize: 60 });
    expect(harness.calls[0]).not.toHaveProperty('q');
    expect(harness.calls[0]).not.toHaveProperty('includeParallels');
    expect(screen.queryByRole('checkbox', { name: '显示平行版本' })).not.toBeInTheDocument();
    expect(screen.queryByText('不编号')).not.toBeInTheDocument();
  });

  it('uses the found count when a filter is active', () => {
    renderList('?rarity=rare');
    expect(screen.getAllByRole('status').some((node) => node.textContent === '找到 1 张')).toBe(
      true,
    );
  });

  it('falls back to the series card count when seriesTotal is absent', () => {
    rootStore.locale.setLocale('en-US');
    const data = harness.state.data;
    if (!data) throw new Error('missing list');
    harness.state.data = {
      items: data.items,
      page: 1,
      pageSize: 60,
      total: 1,
      sort: 'number',
      attributeLabels: labels,
    };
    renderList('', { count: 2 });
    expect(screen.getAllByRole('status').some((node) => node.textContent === '2 cards')).toBe(true);
  });

  it('hides the toolbar for an empty series and shows clear for no matches', async () => {
    const user = userEvent.setup();
    harness.state.data = {
      items: [],
      page: 1,
      pageSize: 60,
      total: 0,
      seriesTotal: 0,
      sort: 'number',
      attributeLabels: labels,
    };
    const empty = renderList('', { count: 0 });
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByText('这个系列还没有卡牌')).toBeInTheDocument();
    empty.unmount();

    harness.state.data = {
      items: [],
      page: 1,
      pageSize: 60,
      total: 0,
      seriesTotal: 4,
      sort: 'number',
      attributeLabels: labels,
    };
    renderList('?q=missing&sort=name');
    expect(screen.getByRole('searchbox', { name: '搜索本系列' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(harness.calls.some((call) => call.q === undefined && call.sort === 'name')).toBe(true);
    expect(screen.getByRole('searchbox', { name: '搜索本系列' })).toHaveFocus();
  });

  it('pushes pagination and does not push each keystroke', async () => {
    const user = userEvent.setup();
    harness.state.data = {
      items: [card('极光', '1')],
      page: 1,
      pageSize: 60,
      total: 61,
      seriesTotal: 61,
      sort: 'number',
      attributeLabels: labels,
    };
    renderList();
    await user.click(screen.getByRole('link', { name: '第 2 页' }));
    expect(harness.calls.at(-1)).toMatchObject({ page: 2 });
    await user.click(screen.getByRole('button', { name: '后退' }));
    expect(harness.calls.at(-1)?.page ?? 1).toBe(1);

    const input = screen.getByRole('searchbox', { name: '搜索本系列' });
    await user.type(input, '龙');
    expect(harness.calls.filter((call) => call.q === '龙')).toHaveLength(0);
    await waitFor(() => {
      expect(harness.calls.some((call) => call.q === '龙' && call.page === 1)).toBe(true);
    });
  });

  it('caps page=10001 and replaces a page past the end with the last page', async () => {
    harness.state.data = {
      items: [],
      page: 10_000,
      pageSize: 60,
      total: 61,
      seriesTotal: 61,
      sort: 'number',
      attributeLabels: labels,
    };
    renderList('?page=10001');
    expect(harness.calls[0]).toMatchObject({ page: 10_000 });
    expect(harness.calls.some((call) => call.page === 10_001)).toBe(false);
    await waitFor(() => {
      expect(harness.calls.at(-1)).toMatchObject({ page: 2 });
      expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
    });
  });

  it('shows an alert for a list error and skeletons while the first request is pending', () => {
    harness.state.isError = true;
    harness.state.error = {
      data: { code: 'INTERNAL_SERVER_ERROR', appCode: 'INTERNAL_SERVER_ERROR' },
    };
    harness.state.data = undefined;
    const failed = renderList();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    failed.unmount();

    harness.state.isError = false;
    harness.state.error = null;
    harness.state.isLoading = true;
    harness.state.isPending = true;
    harness.state.isFetching = true;
    const { container } = renderList();
    expect(container.querySelectorAll('.h-64')).toHaveLength(6);
  });

  it('shows parallels only after the switch is turned on, and keeps the full name in the title', async () => {
    const user = userEvent.setup();
    const longName = '金箔超长平行名称金箔超长平行名称金箔超长';
    harness.state.data = {
      items: [card('极光', '007')],
      page: 2,
      pageSize: 60,
      total: 120,
      seriesTotal: 60,
      parallelCount: 1,
      sort: 'number',
      attributeLabels: labels,
    };
    harness.whenParallels = {
      items: [
        card('极光', '007'),
        {
          ...card('极光', '007'),
          id: 'foil',
          slug: 'aurora-foil',
          parallelName: longName,
          printRun: 99,
          isParallel: true,
        },
        {
          ...card('素版', '008'),
          printRun: null,
          isParallel: true,
          parallelName: '素银',
        },
      ],
      page: 1,
      pageSize: 60,
      total: 3,
      seriesTotal: 1,
      parallelCount: 2,
      sort: 'number',
      attributeLabels: labels,
    };
    renderList('?page=2');
    expect(screen.queryByText(`平行 · ${longName}`)).not.toBeInTheDocument();
    expect(screen.queryByText('不编号')).not.toBeInTheDocument();
    const toggle = screen.getByRole('checkbox', { name: '显示平行版本' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(toggle).toHaveFocus();
    expect(harness.calls.at(-1)).toMatchObject({ includeParallels: true, page: 1 });
    const badge = screen.getByTitle(longName);
    expect(badge).toHaveTextContent(`平行 · ${longName}`);
    expect(badge).toHaveClass('max-w-full');
    expect(badge.querySelector('span')).toHaveClass('min-w-0', 'truncate');
    const limitedNumber = screen.getByText('/99');
    expect(limitedNumber).toHaveClass('font-mono', 'tabular-nums');
    expect(limitedNumber.previousSibling?.textContent?.endsWith(' ')).toBe(true);
    expect(`${limitedNumber.previousSibling?.textContent ?? ''}${limitedNumber.textContent}`).toBe(
      '限量 /99',
    );
    expect(screen.getByText('平行 · 素银')).toBeInTheDocument();
    expect(screen.queryByText('不编号')).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('status').some((node) => node.textContent === '共 3 张（含平行版本）'),
    ).toBe(true);
    expect(screen.getByRole('button', { name: '筛选（1）' })).toBeInTheDocument();
  });

  it('mentions included parallels in Chinese and English when the series has them', () => {
    harness.state.data = {
      items: [card('极光', '007')],
      page: 1,
      pageSize: 60,
      total: 4,
      seriesTotal: 2,
      parallelCount: 2,
      sort: 'number',
      attributeLabels: labels,
    };
    const withParallels = renderList('?parallels=1');
    expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual([
      '共 4 张（含平行版本）',
      '共 4 张（含平行版本）',
    ]);
    withParallels.unmount();

    rootStore.locale.setLocale('en-US');
    const withParallelsEn = renderList('?parallels=1');
    expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual([
      '4 cards (incl. parallels)',
      '4 cards (incl. parallels)',
    ]);
    withParallelsEn.unmount();
  });

  it('does not mention parallels in either language when the series has none', () => {
    harness.state.data = {
      items: [card('极光', '007'), card('素版', '008')],
      page: 1,
      pageSize: 60,
      total: 2,
      seriesTotal: 2,
      parallelCount: 0,
      sort: 'number',
      attributeLabels: labels,
    };
    const plain = renderList('?parallels=1');
    expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual([
      '共 2 张',
      '共 2 张',
    ]);
    expect(screen.queryByText(/含平行版本/)).not.toBeInTheDocument();
    plain.unmount();

    rootStore.locale.setLocale('en-US');
    const plainEn = renderList('?parallels=1');
    expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual([
      '2 cards',
      '2 cards',
    ]);
    expect(screen.queryByText(/incl\. parallels/)).not.toBeInTheDocument();
    plainEn.unmount();
  });

  it('shows the parallel hint instead of an empty series when the series has only parallels', () => {
    harness.state.data = {
      items: [],
      page: 1,
      pageSize: 60,
      total: 0,
      seriesTotal: 0,
      parallelCount: 2,
      sort: 'number',
      attributeLabels: labels,
    };
    renderList();
    expect(screen.getByText('没有符合条件的卡牌')).toBeInTheDocument();
    expect(screen.getByText('打开「显示平行版本」可查看 2 张平行卡')).toBeInTheDocument();
    expect(screen.queryByText('这个系列还没有卡牌')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '显示平行版本' })).not.toBeChecked();
    expect(screen.getByRole('searchbox', { name: '搜索本系列' })).toBeInTheDocument();
  });

  it('hides the parallel hint when another filter caused the empty list', async () => {
    const user = userEvent.setup();
    harness.state.data = {
      items: [],
      page: 1,
      pageSize: 60,
      total: 0,
      seriesTotal: 0,
      parallelCount: 2,
      sort: 'number',
      attributeLabels: labels,
    };
    renderList('?q=missing&sort=name');
    expect(screen.queryByText(/打开「显示平行版本」/)).not.toBeInTheDocument();
    expect(screen.getByText('没有符合条件的卡牌')).toBeInTheDocument();
    expect(screen.queryByText('这个系列还没有卡牌')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(
      harness.calls.some(
        (call) =>
          call.q === undefined && call.sort === 'name' && call.includeParallels === undefined,
      ),
    ).toBe(true);
    expect(screen.getByRole('searchbox', { name: '搜索本系列' })).toHaveFocus();
    expect(screen.getByRole('checkbox', { name: '显示平行版本' })).not.toBeChecked();
  });

  it('keeps parallels on when clearing the other filters', async () => {
    const user = userEvent.setup();
    harness.state.data = {
      items: [],
      page: 1,
      pageSize: 60,
      total: 0,
      seriesTotal: 0,
      parallelCount: 2,
      sort: 'number',
      attributeLabels: labels,
    };
    renderList('?q=missing&parallels=1&sort=name');
    expect(screen.queryByText(/打开「显示平行版本」/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(
      harness.calls.some(
        (call) => call.q === undefined && call.sort === 'name' && call.includeParallels === true,
      ),
    ).toBe(true);
    expect(screen.getByRole('checkbox', { name: '显示平行版本' })).toBeChecked();
  });
});
