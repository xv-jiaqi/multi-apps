import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

type SeriesFixture = {
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  cardCount: number;
};

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

const seriesState: {
  data: { items: SeriesFixture[]; total: number } | undefined;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: { message: string; data?: { code?: string } } | null;
  errorUpdateCount: number;
  dataUpdatedAt: number;
  refetch: () => void;
} = {
  data: { items: [], total: 0 },
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
    series: {
      list: {
        useQuery: () => useSeriesQuery(),
      },
    },
  },
}));

import { HomePage } from './home';

function useSeriesQuery() {
  useSyncExternalStore(bus.subscribe, bus.version, bus.version);
  return seriesState;
}

function renderHome() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

const readySeries = {
  total: 12,
  items: [
    {
      slug: 'celestial-dawn',
      title: '天穹黎明',
      description: '黎明',
      coverUrl: null,
      cardCount: 4,
    },
    {
      slug: 'verdant-rift',
      title: '翠裂之地',
      description: '裂隙',
      coverUrl: null,
      cardCount: 5,
    },
    {
      slug: 'forge-of-titans',
      title: '泰坦熔炉',
      description: '熔炉',
      coverUrl: null,
      cardCount: 6,
    },
  ],
};

function resetSeries() {
  seriesState.data = { items: [], total: 0 };
  seriesState.isLoading = false;
  seriesState.isPending = false;
  seriesState.isFetching = false;
  seriesState.isError = false;
  seriesState.error = null;
  seriesState.errorUpdateCount = 0;
  seriesState.dataUpdatedAt = 1;
  seriesState.refetch = vi.fn();
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  resetSeries();
});

describe('FeaturedSeriesTile contrast', () => {
  it('keeps the cover opacity fixed while hovered and darkens the description', async () => {
    const user = userEvent.setup();
    seriesState.data = {
      total: 2,
      items: [
        {
          slug: 'black-cover',
          title: '纯黑封面',
          description: '黑底说明',
          coverUrl: 'https://example.invalid/black.png',
          cardCount: 1,
        },
        {
          slug: 'forge-of-titans',
          title: '泰坦熔炉',
          description: '机械与火焰',
          coverUrl: 'gradient:from-orange-500-via-red-500-to-rose-700',
          cardCount: 2,
        },
      ],
    };

    renderHome();

    const titan = screen.getByRole('link', { name: /泰坦熔炉/ });
    await user.hover(titan);
    const titanCover = titan.firstElementChild;
    expect(titanCover).toHaveClass('opacity-30');
    expect(titanCover?.className ?? '').not.toMatch(/opacity-50/);
    expect(titan).toHaveClass('hover:-translate-y-1');
    expect(screen.getByText('机械与火焰')).toHaveClass('text-neutral-800');

    const black = screen.getByRole('link', { name: /纯黑封面/ });
    await user.hover(black);
    const blackCover = black.firstElementChild;
    expect(blackCover).toHaveClass('opacity-30');
    expect(blackCover?.className ?? '').not.toMatch(/opacity-50/);
    expect(screen.getByText('黑底说明')).toHaveClass('text-neutral-800');
  });
});

describe('home series data states', () => {
  it('shows a fixed alert on series.list failure and hides the stats', () => {
    seriesState.data = undefined;
    seriesState.isError = true;
    seriesState.error = { message: INJECTED };
    seriesState.errorUpdateCount = 1;
    seriesState.dataUpdatedAt = 0;
    renderHome();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('系列加载失败');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(INJECTED);
    expect(screen.queryByText('系列总览')).not.toBeInTheDocument();
    expect(screen.queryByText('已索引卡牌')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('—');
    expect(screen.getByRole('heading', { name: '所有系列', hidden: true })).toBeInTheDocument();
  });

  it('uses the English series failure copy', () => {
    rootStore.locale.setLocale('en-US');
    seriesState.data = undefined;
    seriesState.isError = true;
    seriesState.error = { message: INJECTED };
    seriesState.errorUpdateCount = 1;
    renderHome();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load series");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps the stats section while loading, without an em dash or an alert', () => {
    seriesState.data = undefined;
    seriesState.isLoading = true;
    seriesState.isPending = true;
    seriesState.isFetching = true;
    seriesState.dataUpdatedAt = 0;
    renderHome();

    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByText('系列总览')).toBeInTheDocument();
    expect(screen.getAllByText('加载中').length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toContain('—');
    expect(screen.queryByText('系列加载失败')).not.toBeInTheDocument();
  });

  it('shows series cards and numeric stats after a successful load', () => {
    seriesState.data = readySeries;
    renderHome();

    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /天穹黎明/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /翠裂之地/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /泰坦熔炉/ })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('—');
  });

  it('moves focus to the series grid after a successful retry', async () => {
    const user = userEvent.setup();
    seriesState.data = undefined;
    seriesState.isError = true;
    seriesState.error = { message: INJECTED };
    seriesState.errorUpdateCount = 1;
    seriesState.dataUpdatedAt = 0;
    seriesState.refetch = () => {
      seriesState.data = readySeries;
      seriesState.isLoading = false;
      seriesState.isPending = false;
      seriesState.isFetching = false;
      seriesState.isError = false;
      seriesState.error = null;
      seriesState.dataUpdatedAt = 2;
      bus.emit();
    };
    renderHome();

    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute('aria-label', '所有系列');
    });
    expect(document.activeElement?.tagName).not.toBe('H2');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
