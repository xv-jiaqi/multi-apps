import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';

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
  attributes: { Cost: '3' },
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
        useQuery: () => useCardQuery(),
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

  it('keeps the dashed not-found box for a missing card', () => {
    cardQuery.isError = true;
    cardQuery.error = { message: INJECTED, data: { code: 'NOT_FOUND' } };
    cardQuery.errorUpdateCount = 1;
    renderCard('not-exist');

    expect(screen.getByText('内容不存在')).toBeInTheDocument();
    expect(screen.getByText('内容不存在')).toHaveClass('border-dashed');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(INJECTED);
    expect(document.title).toBe('not-exist · Cardhub');
    expect(document.querySelector('meta[name="description"]')).toBeNull();
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
  });
});
