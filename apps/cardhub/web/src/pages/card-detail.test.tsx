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
