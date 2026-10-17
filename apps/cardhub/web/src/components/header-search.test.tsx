import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';
import { HeaderSearch } from './header-search';
import { SiteHeader } from './site-header';

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

type GlobalInput = { q?: string; cardLimit?: number; seriesLimit?: number };

const harness = vi.hoisted(() => ({
  calls: [] as Array<{ input: GlobalInput; options?: { enabled?: boolean } }>,
  includeSeries: true,
  refetch: vi.fn(),
}));

const cards = [
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

const series = [
  {
    id: 's1',
    slug: 'celestial-dawn',
    title: '天穹黎明',
    description: '黎明',
    coverUrl: 'https://example.com/cover.png',
    cardCount: 12,
  },
];

vi.mock('../lib/trpc', () => ({
  trpc: {
    search: {
      global: {
        useQuery: (input: GlobalInput, options?: { enabled?: boolean }) => {
          harness.calls.push({ input, options });
          if (!options?.enabled) {
            return {
              data: undefined,
              isLoading: false,
              isFetching: false,
              isError: false,
              isSuccess: false,
              isPlaceholderData: false,
              error: null,
              refetch: harness.refetch,
            };
          }
          return {
            data: {
              query: input.q,
              cards,
              series: harness.includeSeries ? series : [],
            },
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
        useQuery: () => ({ data: { items: [] }, isLoading: false, isError: false }),
      },
    },
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="location">{`${location.pathname}${location.search}`}</output>;
}

function setLg(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('1024') ? matches : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function renderInline() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <button type="button">Elsewhere</button>
              <textarea aria-label="note" />
              <HeaderSearch placement="inline" />
              <LocationProbe />
            </>
          }
        />
        <Route path="/search" element={<LocationProbe />} />
        <Route path="/cards/:cardSlug" element={<LocationProbe />} />
        <Route path="/series/:seriesSlug" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function typeQuery(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = screen.getByRole('combobox', { name: '全站搜索' });
  await user.click(input);
  await user.type(input, value);
  return input;
}

describe('HeaderSearch', () => {
  beforeEach(() => {
    harness.calls.length = 0;
    harness.includeSeries = true;
    harness.refetch.mockReset();
    rootStore.locale.setLocale('zh-CN');
    rootStore.session.signOut();
    setLg(true);
  });

  it('shows cards before series and requests five cards and three series', async () => {
    const user = userEvent.setup();
    renderInline();

    const input = await typeQuery(user, '极光');
    expect(input).toHaveFocus();
    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('极光骑士'),
      expect.stringContaining('冰川哨兵'),
      expect.stringContaining('天穹黎明'),
    ]);
    expect(listbox.textContent?.indexOf('卡牌')).toBeLessThan(
      listbox.textContent?.indexOf('系列') ?? -1,
    );
    expect([...listbox.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual(
      expect.arrayContaining(['https://example.com/aurora.png', 'https://example.com/cover.png']),
    );
    expect(
      harness.calls.some(
        (call) =>
          call.options?.enabled &&
          call.input.q === '极光' &&
          call.input.cardLimit === 5 &&
          call.input.seriesLimit === 3,
      ),
    ).toBe(true);

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[1]?.id);
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[2]?.id);
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('location')).toHaveTextContent('/series/celestial-dawn');
  });

  it('omits an empty series group', async () => {
    harness.includeSeries = false;
    const user = userEvent.setup();
    renderInline();
    await typeQuery(user, '极光');
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('卡牌')).toBeInTheDocument();
    expect(within(listbox).queryByText('系列')).not.toBeInTheDocument();
  });

  it('goes to the search page on Enter without a highlight, and hides that path for a bad prefix', async () => {
    const user = userEvent.setup();
    renderInline();

    await typeQuery(user, '极光');
    await screen.findByRole('listbox');
    expect(screen.getByRole('link', { name: '查看「极光」的全部结果' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(decodeURIComponent(screen.getByLabelText('location').textContent ?? '')).toContain(
      '/search?q=极光',
    );

    cleanup();
    renderInline();
    const next = await typeQuery(user, 'usd<1');
    expect(await screen.findByText(/不支持「usd<1」/)).toBeInTheDocument();
    expect(screen.queryByText('unknownPrefix')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /全部结果/ })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getAllByLabelText('location').at(-1)?.textContent).toBe('/');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(harness.calls.some((call) => call.options?.enabled && call.input.q === 'usd<1')).toBe(
      false,
    );
    expect(next).toHaveValue('usd<1');
  });

  it('does not request an empty or condition-less query', async () => {
    const user = userEvent.setup();
    renderInline();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(harness.calls.some((call) => call.options?.enabled)).toBe(false);

    await typeQuery(user, 'r:');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(harness.calls.some((call) => call.options?.enabled)).toBe(false);
  });

  it('closes on the first Escape, clears on the second, and does not select on Tab', async () => {
    const user = userEvent.setup();
    renderInline();

    const input = await typeQuery(user, '极光');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('极光');
    expect(screen.getByLabelText('location')).toHaveTextContent('/');

    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');

    await user.type(input, '极光');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Tab}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('location')).toHaveTextContent('/');
  });

  it('focuses the inline search on slash only at lg and outside editable fields', async () => {
    const user = userEvent.setup();
    renderInline();
    const input = screen.getByRole('combobox', { name: '全站搜索' });
    expect(input).toHaveAttribute('aria-keyshortcuts', '/');
    expect(input.className).toContain('h-8');

    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    await user.keyboard('/');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    await screen.findByText('试试：');

    const note = screen.getByRole('textbox', { name: 'note' });
    note.focus();
    await user.keyboard('/');
    expect(note).toHaveValue('/');
    expect(input).not.toHaveFocus();

    const select = document.createElement('select');
    document.body.append(select);
    select.focus();
    await user.keyboard('/');
    expect(input).not.toHaveFocus();
    select.remove();

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.tabIndex = 0;
    document.body.append(editable);
    editable.focus();
    editable.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }),
    );
    expect(input).not.toHaveFocus();
    editable.remove();

    setLg(false);
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    await user.keyboard('/');
    expect(input).not.toHaveFocus();
  });

  it('uses a syntax example without blurring the field', async () => {
    const user = userEvent.setup();
    renderInline();
    const input = screen.getByRole('combobox', { name: '全站搜索' });
    await user.click(input);
    await user.click(await screen.findByRole('button', { name: '用「r:legendary」搜索' }));
    expect(input).toHaveValue('r:legendary');
    expect(input).toHaveFocus();
  });
});

describe('SiteHeader search entry points', () => {
  beforeEach(() => {
    harness.calls.length = 0;
    harness.includeSeries = true;
    rootStore.locale.setLocale('zh-CN');
    rootStore.session.signOut();
    setLg(false);
  });

  it('hides the desktop search link at lg and places search at the top of the drawer', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <SiteHeader />
        <Routes>
          <Route path="/" element={<LocationProbe />} />
          <Route path="/series/:seriesSlug" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const inline = container.querySelector('div.w-56');
    expect(inline).toHaveClass('ml-auto', 'hidden', 'lg:block', 'xl:w-72');
    const searchLink = screen.getByRole('link', { name: '搜索' });
    expect(searchLink.className).toContain('lg:hidden');
    expect(screen.getByRole('button', { name: '切换界面语言' }).parentElement).toHaveClass(
      'lg:ml-0',
    );

    await user.click(screen.getByRole('button', { name: '打开导航菜单' }));
    const drawer = document.getElementById('mobile-nav');
    if (!drawer) throw new Error('drawer missing');
    const drawerInput = within(drawer).getByRole('combobox', { name: '全站搜索' });
    expect(drawerInput).not.toHaveFocus();
    expect(drawerInput.className).toContain('h-10');
    expect(drawer.querySelector('.pb-2')).toBeTruthy();
    expect(within(drawer).getByRole('link', { name: '搜索' })).toBeInTheDocument();

    await user.click(drawerInput);
    await user.type(drawerInput, '极光');
    const option = await screen.findByRole('option', { name: /收录 12/ });
    await user.click(option);
    expect(document.getElementById('mobile-nav')).toBeNull();
    expect(decodeURIComponent(screen.getByLabelText('location').textContent ?? '')).toContain(
      '/series/celestial-dawn',
    );
  });
});
