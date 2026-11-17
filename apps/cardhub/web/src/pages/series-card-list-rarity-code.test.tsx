import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';
import { SeriesCardList } from './series-card-list';

type Tile = {
  id: string;
  slug: string;
  name: string;
  rarity: string;
  imageUrl: null;
  cardNumber: string;
  subsetSlug: null;
  attributes: Record<string, string>;
  parallelName: string | null;
  printRun: null;
  isParallel: boolean;
  rarityCode: string | null;
};

type Input = Record<string, unknown>;

const harness = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  cards: [] as Array<Record<string, unknown>>,
  rarityCodes: [] as string[],
  baseRarityCodes: [] as string[],
  /** Inputs whose answer is still in flight: the previous answer is shown as placeholder. */
  pending: (_input: Record<string, unknown>): boolean => false,
  last: undefined as Record<string, unknown> | undefined,
}));

function answer(input: Input) {
  const all = harness.cards as Tile[];
  const items = all.filter((tile) => {
    if (!input.includeParallels && tile.isParallel) return false;
    if (typeof input.rarityCode === 'string' && tile.rarityCode !== input.rarityCode) return false;
    if (typeof input.rarity === 'string' && tile.rarity !== input.rarity) return false;
    return true;
  });
  return {
    items,
    page: 1,
    pageSize: 60,
    total: items.length,
    seriesTotal: all.filter((tile) => !tile.isParallel).length,
    parallelCount: all.filter((tile) => tile.isParallel).length,
    sort: 'number' as const,
    attributeLabels: {},
    rarityCodes: harness.rarityCodes,
    baseRarityCodes: harness.baseRarityCodes,
  };
}

vi.mock('../lib/trpc', () => ({
  trpc: {
    cards: {
      listBySeries: {
        useQuery: (input: Record<string, unknown>) => {
          harness.calls.push(input);
          const inFlight = harness.pending(input) && harness.last !== undefined;
          const data = inFlight ? harness.last : answer(input);
          if (!inFlight) harness.last = data;
          return {
            data,
            isPlaceholderData: inFlight,
            isLoading: false,
            isPending: false,
            isFetching: inFlight,
            isError: false,
            error: null,
            refetch: vi.fn(),
          };
        },
      },
    },
  },
}));

function tile(
  number: string,
  rarityCode: string | null,
  extra: Partial<Pick<Tile, 'isParallel' | 'rarity'>> = {},
): Tile {
  const isParallel = extra.isParallel ?? false;
  return {
    id: `${number}${isParallel ? 'p' : ''}`,
    slug: `card-${number}${isParallel ? '-p' : ''}`,
    name: `卡${number}${isParallel ? '平行' : ''}`,
    rarity: extra.rarity ?? 'legendary',
    imageUrl: null,
    cardNumber: number,
    subsetSlug: null,
    attributes: rarityCode ? { 稀有度: rarityCode } : {},
    parallelName: isParallel ? '闪' : null,
    printRun: null,
    isParallel,
    rarityCode,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="search">{decodeURIComponent(location.search)}</output>;
}

function renderList(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/series/dawn${search}`]}>
      <Routes>
        <Route
          path="/series/:seriesSlug"
          element={
            <>
              <SeriesCardList seriesSlug="dawn" subsets={[]} fallbackCardCount={3} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const search = () => screen.getByTestId('search').textContent ?? '';
const rarityTrigger = (name = '稀有度') => screen.getByRole('combobox', { name });

async function openRarity(user: ReturnType<typeof userEvent.setup>, name = '稀有度') {
  rarityTrigger(name).focus();
  await user.keyboard('{Enter}');
  return screen.findByRole('listbox');
}

/** Text a screen reader reads: aria-hidden parts left out. */
function spoken(node: Element): string {
  const copy = node.cloneNode(true);
  if (!(copy instanceof Element)) return '';
  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
  return copy.textContent ?? '';
}

function optionTexts(listbox: HTMLElement) {
  return within(listbox).getAllByRole('option').map(spoken);
}

beforeAll(() => {
  // jsdom has no scrollIntoView; Radix Select calls it on the open list.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  harness.calls.length = 0;
  harness.last = undefined;
  harness.pending = () => false;
  // Base cards carry C, SAR, ★★★; SSR is printed only on a parallel.
  harness.cards = [
    tile('001', 'C', { rarity: 'common' }),
    tile('001', 'SSR', { isParallel: true, rarity: 'epic' }),
    tile('124', 'SAR'),
    tile('125', '★★★'),
  ];
  harness.rarityCodes = ['C', 'SSR', 'SAR', '★★★'];
  harness.baseRarityCodes = ['C', 'SAR', '★★★'];
  rootStore.locale.setLocale('zh-CN');
});

describe('SeriesCardList official rarity code (Spec CH-239 v1.3)', () => {
  it('replaces the 4-tier filter with base-card codes while parallels are off (§1 §3)', async () => {
    const user = userEvent.setup();
    renderList('?rarity=legendary');
    await waitFor(() => expect(search()).toBe(''));
    expect(screen.getAllByRole('combobox', { name: '稀有度' })).toHaveLength(1);
    const listbox = await openRarity(user);
    expect(optionTexts(listbox)).toEqual(['全部', '稀有度码 C', '稀有度码 SAR', '三星']);
    expect(within(listbox).queryByRole('option', { name: /传说/ })).toBeNull();
    expect(harness.calls.at(-1)).not.toHaveProperty('rarity');
  });

  it('offers the parallel-only code once the switch is on, in rarityCodes order (§3)', async () => {
    const user = userEvent.setup();
    renderList('?parallels=1');
    const listbox = await openRarity(user);
    expect(optionTexts(listbox)).toEqual([
      '全部',
      '稀有度码 C',
      '稀有度码 SSR',
      '稀有度码 SAR',
      '三星',
    ]);
  });

  it('pushes the chosen code, resets page, and shows code badges on tiles (§2 §4)', async () => {
    const user = userEvent.setup();
    renderList('?page=2&sort=name');
    await openRarity(user);
    await user.click(screen.getByRole('option', { name: '稀有度码 SAR' }));
    await waitFor(() => expect(search()).toBe('?rarityCode=SAR&sort=name'));
    expect(harness.calls.at(-1)).toMatchObject({ rarityCode: 'SAR', page: 1 });
    expect(spoken(rarityTrigger())).toBe('稀有度码 SAR');
    const badge = screen.getByTitle('SAR');
    expect(badge).toHaveClass('bg-neutral-100', 'text-neutral-600', 'max-w-24', 'shrink-0');
    expect(screen.queryByText('传说')).toBeNull();
    expect(screen.getByRole('button', { name: '筛选（1）' })).toBeInTheDocument();
  });

  it('reads symbol codes by name and keeps the raw symbol visible', () => {
    renderList();
    const star = screen.getByTitle('★★★');
    expect(within(star).getByText('★★★')).toHaveAttribute('aria-hidden', 'true');
    expect(within(star).getByText('三星')).toHaveClass('sr-only');
  });

  it('drops a code that is not in the series, case-sensitively, without an empty state (§2)', async () => {
    renderList('?rarityCode=sar&sort=name');
    await waitFor(() => expect(search()).toBe('?sort=name'));
    expect(screen.queryByText('没有符合条件的卡牌')).toBeNull();
    expect(harness.calls.at(-1)).not.toHaveProperty('rarityCode');
    expect(screen.getByText('卡124')).toBeInTheDocument();
  });

  it('shows the skeleton, not 「没有符合条件的卡牌」, while the list without the dropped code loads', async () => {
    harness.pending = (input) => input.rarityCode === undefined;
    const view = renderList('?rarityCode=XYZ');
    await waitFor(() => expect(search()).toBe(''));
    expect(screen.queryByText('没有符合条件的卡牌')).toBeNull();
    expect(view.container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    harness.pending = () => false;
    view.rerender(
      <MemoryRouter initialEntries={['/series/dawn']}>
        <Routes>
          <Route
            path="/series/:seriesSlug"
            element={<SeriesCardList seriesSlug="dawn" subsets={[]} fallbackCardCount={3} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('卡124')).toBeInTheDocument();
  });

  it('keeps a parallel-only code from an old link with parallels off and shows the empty state (§2 §5)', async () => {
    const user = userEvent.setup();
    renderList('?rarityCode=SSR');
    expect(await screen.findByText('没有符合条件的卡牌')).toBeInTheDocument();
    expect(search()).toBe('?rarityCode=SSR');
    expect(screen.getByRole('checkbox', { name: '显示平行版本' })).not.toBeChecked();
    expect(rarityTrigger()).toHaveTextContent('SSR');
    const listbox = await openRarity(user);
    expect(optionTexts(listbox)).not.toContain('稀有度码 SSR');
    await user.keyboard('{Escape}');
    // Turning the switch on brings the code into the options and lists its card.
    await user.click(screen.getByRole('checkbox', { name: '显示平行版本' }));
    await waitFor(() => expect(search()).toBe('?rarityCode=SSR&parallels=1'));
    expect(screen.getByText('卡001平行')).toBeInTheDocument();
    expect(screen.queryByText('没有符合条件的卡牌')).toBeNull();
  });

  it('keeps the chosen code when the user turns parallels off and shows the empty state (§2 §5)', async () => {
    const user = userEvent.setup();
    renderList('?rarityCode=SSR&parallels=1');
    expect(await screen.findByText('卡001平行')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: '显示平行版本' }));
    await waitFor(() => expect(search()).toBe('?rarityCode=SSR'));
    expect(screen.getByText('没有符合条件的卡牌')).toBeInTheDocument();
    expect(rarityTrigger()).toHaveTextContent('SSR');
  });

  it('clears rarityCode with the other filters, keeps parallels, and focuses the keyword box (§2 §5)', async () => {
    const user = userEvent.setup();
    renderList('?rarityCode=SSR');
    await user.click(await screen.findByRole('button', { name: '清除筛选' }));
    await waitFor(() => expect(search()).toBe(''));
    expect(screen.getByRole('searchbox', { name: '搜索本系列' })).toHaveFocus();

    renderList('?rarityCode=XYZ&parallels=1&sort=name');
    await waitFor(() =>
      expect(screen.getAllByTestId('search').at(-1)?.textContent).toBe('?parallels=1&sort=name'),
    );
  });

  it('keeps the 4-tier filter and drops rarityCode when the series has no codes (§1)', async () => {
    const user = userEvent.setup();
    harness.cards = [tile('1', null, { rarity: 'rare' }), tile('2', null, { rarity: 'common' })];
    harness.rarityCodes = [];
    harness.baseRarityCodes = [];
    renderList('?rarityCode=SAR&rarity=rare');
    await waitFor(() => expect(search()).toBe('?rarity=rare'));
    const listbox = await openRarity(user);
    expect(optionTexts(listbox)).toEqual(['全部', '普通', '稀有', '史诗', '传说']);
    expect(screen.getAllByText('稀有').length).toBeGreaterThan(0);
  });

  it('uses English names for symbol and unmarked codes', async () => {
    const user = userEvent.setup();
    rootStore.locale.setLocale('en-US');
    harness.cards = [tile('1', '无标记'), tile('2', '●')];
    harness.rarityCodes = ['无标记', '●'];
    harness.baseRarityCodes = ['无标记', '●'];
    renderList();
    const listbox = await openRarity(user, 'Rarity');
    expect(optionTexts(listbox)).toEqual(['All', 'Unmarked', 'Circle mark']);
    expect(screen.getByTitle('Unmarked')).toBeInTheDocument();
  });

  it('keeps a 10-character code whole in the DOM but lets the trigger value shrink and truncate (§3 §10-10)', async () => {
    const user = userEvent.setup();
    const long = '超级稀有特别插画平行';
    harness.cards = [tile('1', 'C'), tile('2', long)];
    harness.rarityCodes = ['C', long];
    harness.baseRarityCodes = ['C', long];
    renderList(`?rarityCode=${encodeURIComponent(long)}`);
    await waitFor(() => expect(search()).toBe(`?rarityCode=${long}`));
    const trigger = rarityTrigger();
    // The value span is a flex item of the trigger: without min-w-0 on it (`*:min-w-0`) it cannot
    // shrink and pushes the chevron out of the box.
    expect(trigger).toHaveClass('min-w-0', 'overflow-hidden', '*:min-w-0');
    expect(trigger.querySelector('span > span')).toHaveClass('block', 'min-w-0', 'truncate');
    expect(trigger.lastElementChild).toHaveClass('shrink-0');
    // Truncation is visual only: the accessible value is the full code, no hand-written ellipsis.
    expect(spoken(trigger)).toBe(long);
    expect(trigger.textContent).not.toContain('…');
    const listbox = await openRarity(user);
    const option = within(listbox).getByRole('option', { name: long });
    expect(option).toHaveClass('whitespace-normal', 'wrap-anywhere');
    expect(spoken(option)).toBe(long);
  });
});
