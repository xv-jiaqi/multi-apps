import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';

const bySlugInputs = vi.hoisted(() => [] as unknown[]);
const INJECTED = 'QA-INJECTED-xyz';

const bus = vi.hoisted(() => {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    version: () => version,
    emit() {
      version += 1;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

const card = {
  slug: 'aurora-knight',
  name: '极光骑士',
  description: '黎明降临。',
  imageUrl: null,
  rarity: 'rare',
  seriesSlug: 'celestial-dawn',
  seriesTitle: '天穹黎明',
  cardNumber: null as string | null,
  attributes: { Cost: '3', attack: 2 },
  printRun: null as number | null,
  parallelName: null as string | null,
  isParallel: false,
  base: null as { slug: string; name: string } | null,
  subset: null as { slug: string; name: string } | null,
  body: null as string | null,
  adjacent: { prev: null, next: null } as {
    prev: { slug: string; name: string; imageUrl: string | null } | null;
    next: { slug: string; name: string; imageUrl: string | null } | null;
  },
  variants: [] as Array<{
    slug: string;
    name: string;
    parallelName: string | null;
    printRun: number | null;
    imageUrl: string | null;
    isCurrent: boolean;
  }>,
};

const cardQuery: {
  data: typeof card | undefined;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: { message: string; data?: { code?: string } } | null;
  errorUpdateCount: number;
  dataUpdatedAt: number;
  refetch: () => void;
} = {
  data: undefined,
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  error: null,
  errorUpdateCount: 0,
  dataUpdatedAt: 0,
  refetch: vi.fn(),
};

const idleQuery = {
  data: [],
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  error: null,
  errorUpdateCount: 0,
  dataUpdatedAt: 1,
  refetch: vi.fn(),
};

vi.mock('../lib/trpc', () => ({
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
        }),
      },
    },
    cards: {
      bySlug: {
        useQuery: (input: unknown) => {
          bySlugInputs.push(input);
          return useCardQuery();
        },
      },
    },
    listings: {
      byCard: {
        useQuery: () => idleQuery,
      },
    },
    collection: {
      byCard: { useQuery: () => idleQuery },
      upsert: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    comments: {
      listForCard: { useQuery: () => idleQuery },
      listForSeries: { useQuery: () => idleQuery },
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

function useCardQuery() {
  useSyncExternalStore(bus.subscribe, bus.version, bus.version);
  return cardQuery;
}

function resetCard() {
  cardQuery.data = undefined;
  cardQuery.isLoading = false;
  cardQuery.isPending = false;
  cardQuery.isFetching = false;
  cardQuery.isError = false;
  cardQuery.error = null;
  cardQuery.errorUpdateCount = 0;
  cardQuery.dataUpdatedAt = 0;
  cardQuery.refetch = vi.fn();
}

function renderCard(slug = 'aurora-knight') {
  return render(
    <MemoryRouter initialEntries={[`/cards/${slug}`]}>
      <Routes>
        <Route path="/cards/:cardSlug" element={<CardDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  card.description = '黎明降临。';
  card.cardNumber = null;
  card.printRun = null;
  card.parallelName = null;
  card.isParallel = false;
  card.base = null;
  card.subset = null;
  card.body = null;
  card.adjacent = { prev: null, next: null };
  card.variants = [];
  bySlugInputs.length = 0;
  resetCard();
});

describe('card detail data errors', () => {
  it('shows a fixed alert for a 500 and never the server message', () => {
    cardQuery.isError = true;
    cardQuery.error = { message: INJECTED, data: { code: 'INTERNAL_SERVER_ERROR' } };
    cardQuery.errorUpdateCount = 1;
    renderCard();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('卡牌加载失败');
    expect(screen.getByRole('heading', { level: 1, name: '卡牌加载失败' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '面包屑导航' })).toHaveTextContent(
      'aurora-knight',
    );
    expect(document.body.textContent).not.toContain(INJECTED);
    expect(document.title).toBe('卡牌加载失败 · Cardhub');
    expect(document.querySelector('meta[name="description"]')).toBeNull();
  });

  it('uses the English card failure copy', () => {
    rootStore.locale.setLocale('en-US');
    cardQuery.isError = true;
    cardQuery.error = { message: INJECTED, data: { code: 'INTERNAL_SERVER_ERROR' } };
    cardQuery.errorUpdateCount = 1;
    renderCard();

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this card");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(document.title).toBe("Couldn't load this card · Cardhub");
  });

  it('shows the not-found copy as a page-size h1 for a missing card', () => {
    cardQuery.isError = true;
    cardQuery.error = { message: INJECTED, data: { code: 'NOT_FOUND' } };
    cardQuery.errorUpdateCount = 1;
    renderCard('not-exist');

    expect(screen.getByText('内容不存在')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '内容不存在' })).toHaveClass(
      'text-2xl',
      'font-bold',
      'tracking-tight',
      'sm:text-3xl',
    );
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(INJECTED);
    expect(document.title).toBe('not-exist · Cardhub');
    expect(document.querySelector('meta[name="description"]')).toBeNull();
  });

  it.each(['NOT_FOUND', 'INTERNAL_SERVER_ERROR'])(
    'links the second breadcrumb to the series list on %s (CH-206 §4)',
    (code) => {
      cardQuery.isError = true;
      cardQuery.error = { message: INJECTED, data: { code } };
      cardQuery.errorUpdateCount = 1;
      renderCard();
      const nav = screen.getByRole('navigation', { name: '面包屑导航' });
      expect(within(nav).getByRole('link', { name: '系列' })).toHaveAttribute('href', '/series');
      expect(within(nav).queryByText('卡牌')).toBeNull();
    },
  );

  it('sizes the load-failure h1 like the normal title (CH-206 §1)', () => {
    cardQuery.isError = true;
    cardQuery.error = { message: INJECTED, data: { code: 'INTERNAL_SERVER_ERROR' } };
    cardQuery.errorUpdateCount = 1;
    renderCard();
    const h1 = screen.getByRole('heading', { level: 1, name: '卡牌加载失败' });
    expect(h1).toHaveClass('text-2xl', 'font-bold', 'tracking-tight', 'sm:text-3xl');
    expect(h1).not.toHaveClass('font-medium');
  });

  it('shows the skeleton while loading and no alert', () => {
    cardQuery.isLoading = true;
    cardQuery.isPending = true;
    cardQuery.isFetching = true;
    renderCard();

    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"] .animate-pulse')).toHaveClass(
      'motion-reduce:animate-none',
    );
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText('卡牌加载失败')).not.toBeInTheDocument();
    expect(document.querySelector('meta[name="description"]')).toBeNull();
  });

  it('keeps the alert while a retry is in flight', () => {
    cardQuery.isPending = true;
    cardQuery.isFetching = true;
    cardQuery.isLoading = false;
    cardQuery.isError = false;
    cardQuery.error = { message: INJECTED, data: { code: 'INTERNAL_SERVER_ERROR' } };
    cardQuery.errorUpdateCount = 1;
    cardQuery.dataUpdatedAt = 0;
    renderCard();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试中…' })).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('.aspect-\\[63\\/88\\]')).toBeNull();
    expect(document.querySelector('meta[name="description"]')).toBeNull();
  });

  it('moves focus to the card name after a successful retry', async () => {
    const user = userEvent.setup();
    cardQuery.isError = true;
    cardQuery.error = { message: INJECTED, data: { code: 'INTERNAL_SERVER_ERROR' } };
    cardQuery.errorUpdateCount = 1;
    cardQuery.refetch = () => {
      cardQuery.data = card;
      cardQuery.isLoading = false;
      cardQuery.isPending = false;
      cardQuery.isFetching = false;
      cardQuery.isError = false;
      cardQuery.error = null;
      cardQuery.dataUpdatedAt = 2;
      bus.emit();
    };
    renderCard();

    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(document.activeElement).toHaveTextContent('极光骑士');
    });
    expect(document.activeElement?.tagName).toBe('H1');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});

describe('card detail meta description', () => {
  function showCard() {
    cardQuery.data = card;
    cardQuery.isLoading = false;
    cardQuery.isPending = false;
    cardQuery.isFetching = false;
    cardQuery.isError = false;
    cardQuery.error = null;
    cardQuery.dataUpdatedAt = 1;
  }

  it('keeps one h1, the body h2 and body headings from h3 (CH-222 22-2)', () => {
    card.body = '# 一级\n## 价格\n### 细则\n#### 备注\n##### 五级\n###### 六级';
    showCard();
    renderCard();
    const all = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    expect(all.filter((h) => h.tagName === 'H1').map((h) => h.textContent)).toEqual(['极光骑士']);
    const about = screen.getByRole('heading', { level: 2, name: '介绍' });
    const section = about.closest('section')!;
    const inBody = [...section.querySelectorAll('h3, h4, h5, h6')].map((h) => [
      h.tagName,
      h.textContent,
    ]);
    expect(inBody).toEqual([
      ['H3', '一级'],
      ['H3', '价格'],
      ['H4', '细则'],
      ['H5', '备注'],
      ['H6', '五级'],
      ['H6', '六级'],
    ]);
    const after = all.slice(all.indexOf(about) + 1).filter((h) => !section.contains(h));
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((h) => h.tagName === 'H2')).toBe(true);
  });

  it('adds the subset to the breadcrumb, renders the body and the neighbour links (CH-206)', () => {
    card.subset = { slug: 'foil', name: '闪卡' };
    card.body = '## 背景\n\n长描述正文';
    card.adjacent = { prev: { slug: 'p', name: '上张', imageUrl: null }, next: null };
    showCard();
    renderCard();
    const crumbs = screen.getByRole('navigation', { name: /面包屑|breadcrumb/i });
    expect(within(crumbs).getByRole('link', { name: '闪卡' })).toHaveAttribute(
      'href',
      '/series/celestial-dawn?subset=foil',
    );
    expect(screen.getByRole('heading', { level: 2, name: '介绍' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '背景' })).toBeInTheDocument();
    expect(screen.getByText('长描述正文')).toBeInTheDocument();
    const adjacent = screen.getByRole('navigation', { name: '上一张和下一张' });
    expect(within(adjacent).getByRole('link')).toHaveAttribute('href', '/cards/p');
    expect(bySlugInputs.at(-1)).toEqual({ slug: 'aurora-knight' });
  });

  it('sends via=adjacent only when the route state says so', () => {
    showCard();
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/cards/aurora-knight', state: { via: 'adjacent' } }]}
      >
        <Routes>
          <Route path="/cards/:cardSlug" element={<CardDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(bySlugInputs.at(-1)).toEqual({ slug: 'aurora-knight', via: 'adjacent' });
  });

  it('omits a missing number and includes one when the card has it', () => {
    showCard();
    const view = renderCard();

    expect(document.title).toBe('极光骑士 · Cardhub');
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      '极光骑士 · 天穹黎明。在 Cardhub 查看卡牌资料、交易和讨论。 黎明降临。',
    );

    view.unmount();
    card.cardNumber = '58';
    rootStore.locale.setLocale('en-US');
    renderCard();
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      '极光骑士 from 天穹黎明, No. 58. See details, trades, and discussion on Cardhub. 黎明降临。',
    );
  });

  it('puts the plain text of a Markdown description after the template', () => {
    card.description = '```\ncode\n```\n**辉光**足够。';
    card.cardNumber = '001';
    showCard();
    renderCard();

    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      '极光骑士 · 天穹黎明 No.001。在 Cardhub 查看卡牌资料、交易和讨论。 辉光足够。',
    );
  });

  it('localizes attack and keeps the label at neutral-600', () => {
    showCard();
    renderCard();
    const attack = screen.getByText('攻击');
    expect(attack.tagName).toBe('DT');
    expect(attack).toHaveClass('text-neutral-600');
    expect(attack.className).not.toContain('uppercase');
    expect(attack.className).not.toContain('neutral-500');
    expect(screen.getByText('Cost')).toBeInTheDocument();
  });

  it('uses the English attribute label', () => {
    rootStore.locale.setLocale('en-US');
    showCard();
    renderCard();
    const attack = screen.getByText('Attack');
    expect(attack.tagName).toBe('DT');
    expect(attack).toHaveClass('text-neutral-600');
  });

  it('places the collection bar after the title and before attributes', () => {
    showCard();
    renderCard();

    const title = screen.getByRole('heading', { level: 1, name: '极光骑士' });
    const region = screen.getByRole('region', { name: '我的收藏' });
    const attributes = screen.getByRole('heading', { name: '属性' });
    expect(title.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      region.compareDocumentPosition(attributes) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '我有' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('textbox', { name: '数量' })).not.toBeInTheDocument();
    expect(screen.getByText('不编号')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '同组版本' })).not.toBeInTheDocument();
  });
});

describe('card detail variants', () => {
  function showCard() {
    cardQuery.data = card;
    cardQuery.isLoading = false;
    cardQuery.isPending = false;
    cardQuery.isFetching = false;
    cardQuery.isError = false;
    cardQuery.error = null;
    cardQuery.dataUpdatedAt = 1;
  }

  function installMatchMedia(narrow: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: narrow && query.includes('max-width'),
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

  beforeEach(() => {
    installMatchMedia(false);
  });

  it('lists the group in server order, marks the current card, and shows a limited total', () => {
    card.printRun = 99;
    card.parallelName = '金箔';
    card.isParallel = true;
    card.cardNumber = '001';
    card.subset = { slug: 'base', name: '主卡' };
    card.base = { slug: 'aurora-base', name: '极光骑士' };
    card.variants = [
      {
        slug: 'aurora-base',
        name: '极光骑士',
        parallelName: null,
        printRun: null,
        imageUrl: null,
        isCurrent: false,
      },
      {
        slug: 'aurora-knight',
        name: '极光骑士',
        parallelName: '金箔',
        printRun: 99,
        imageUrl: null,
        isCurrent: true,
      },
      {
        slug: 'aurora-plain',
        name: '极光骑士',
        parallelName: '素银',
        printRun: null,
        imageUrl: null,
        isCurrent: false,
      },
    ];
    showCard();
    renderCard();

    expect(screen.getByText(/平行 · 金箔/)).toBeInTheDocument();
    expect(screen.getAllByText('/99').some((node) => node.className.includes('font-mono'))).toBe(
      true,
    );
    expect(screen.getByRole('link', { name: '基础卡：极光骑士' })).toHaveAttribute(
      'href',
      '/cards/aurora-base',
    );
    const region = screen.getByRole('region', { name: '同组版本' });
    const items = within(region).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('基础版'),
      expect.stringContaining('金箔'),
      expect.stringContaining('素银'),
    ]);
    expect(items[0]).toHaveTextContent('不编号');
    expect(items[1]).toHaveTextContent('限量 /99');
    expect(items[1]).toHaveTextContent('（当前）');
    expect(within(items[1]!).getByText('（当前）').closest('[aria-current="page"]')).toBeTruthy();
    expect(within(items[1]!).queryByRole('link')).not.toBeInTheDocument();
    expect(within(items[2]!).getByRole('link')).toHaveAttribute('href', '/cards/aurora-plain');
    expect(screen.queryByRole('button', { name: /显示全部/ })).not.toBeInTheDocument();
  });

  it('shows an orphan parallel as a base card with only the print run', () => {
    card.name = '孤儿卡';
    card.parallelName = '孤儿X';
    card.printRun = 7;
    card.isParallel = false;
    card.base = null;
    card.cardNumber = '002';
    card.variants = [
      {
        slug: 'orphan-y',
        name: '孤儿卡',
        parallelName: '孤儿X',
        printRun: 7,
        imageUrl: null,
        isCurrent: true,
      },
    ];
    showCard();
    renderCard('orphan-y');

    expect(screen.queryByText(/平行/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /基础卡/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '同组版本' })).not.toBeInTheDocument();
    expect(screen.getByText(/限量/)).toHaveTextContent('限量 /7');
  });

  it('shows the first six versions on a narrow screen and focuses the seventh', async () => {
    const user = userEvent.setup();
    installMatchMedia(true);
    card.variants = Array.from({ length: 7 }, (_, index) => ({
      slug: `v-${index}`,
      name: '极光骑士',
      parallelName: index === 0 ? null : `版本${index}`,
      printRun: null,
      imageUrl: null,
      isCurrent: false,
    }));
    showCard();
    renderCard();

    const region = screen.getByRole('region', { name: '同组版本' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(6);
    await user.click(screen.getByRole('button', { name: '显示全部 7 个版本' }));
    expect(within(region).getAllByRole('listitem')).toHaveLength(7);
    expect(document.activeElement).toHaveTextContent('版本6');
  });
});
