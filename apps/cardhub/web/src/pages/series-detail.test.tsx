import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';

const SERVER_TEXT = 'Invalid time value';

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

const series = {
  slug: 'celestial-dawn',
  title: '天穹黎明',
  description: '黎明。',
  coverUrl: null,
  cards: [{ slug: 'aurora-knight', name: '极光骑士', rarity: 'rare', imageUrl: null }],
};

const seriesQuery: {
  data: typeof series | undefined;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: { message: string; data?: { code?: string; appCode?: string } } | null;
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
      bySlug: {
        useQuery: () => useSeriesQuery(),
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
    useUtils: () => ({
      comments: {
        listForCard: { invalidate: vi.fn() },
        listForSeries: { invalidate: vi.fn() },
      },
    }),
  },
}));

import { SeriesDetailPage } from './series-detail';

function useSeriesQuery() {
  useSyncExternalStore(bus.subscribe, bus.version, bus.version);
  return seriesQuery;
}

function renderSeries(slug = 'celestial-dawn') {
  return render(
    <MemoryRouter initialEntries={[`/series/${slug}`]}>
      <Routes>
        <Route path="/series/:seriesSlug" element={<SeriesDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function resetSeries() {
  seriesQuery.data = undefined;
  seriesQuery.isLoading = false;
  seriesQuery.isPending = false;
  seriesQuery.isFetching = false;
  seriesQuery.isError = true;
  seriesQuery.error = {
    message: SERVER_TEXT,
    data: { code: 'INTERNAL_SERVER_ERROR', appCode: 'INTERNAL_SERVER_ERROR' },
  };
  seriesQuery.errorUpdateCount = 1;
  seriesQuery.dataUpdatedAt = 0;
  seriesQuery.refetch = vi.fn();
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  series.description = '黎明。';
  resetSeries();
});

describe('series detail server errors', () => {
  it('shows the localized alert in zh and never the server text', () => {
    renderSeries();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('出了点问题，请稍后再试');
    expect(
      screen.getByRole('heading', { level: 1, name: '出了点问题，请稍后再试' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '面包屑导航' })).toHaveTextContent(
      'celestial-dawn',
    );
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(document.body.textContent).not.toContain('prisma');
    expect(document.title).toBe('出了点问题，请稍后再试 · Cardhub');
    expect(document.title).not.toContain(SERVER_TEXT);
    expect(document.querySelector('meta[name="description"]')).toBeNull();
  });

  it('shows the localized alert in en and never the server text', () => {
    rootStore.locale.setLocale('en-US');
    renderSeries();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again later.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(document.title).toBe('Something went wrong. Try again later. · Cardhub');
  });

  it('keeps the dashed not-found copy and hides the server message', () => {
    seriesQuery.error = {
      message: SERVER_TEXT,
      data: { code: 'NOT_FOUND', appCode: 'NOT_FOUND' },
    };
    renderSeries('missing-series');

    expect(screen.getByText('内容不存在')).toBeInTheDocument();
    expect(screen.getByText('内容不存在')).toHaveClass('border-dashed');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(document.title).toBe('missing-series · Cardhub');
    expect(document.querySelector('meta[name="description"]')).toBeNull();
  });

  it('uses the generic sentence for forbidden, unauthorized, and unknown codes', () => {
    for (const appCode of ['FORBIDDEN', 'UNAUTHORIZED', 'UNKNOWN'] as const) {
      seriesQuery.error = { message: SERVER_TEXT, data: { code: appCode, appCode } };
      const view = renderSeries();
      expect(screen.getByRole('alert')).toHaveTextContent('出了点问题，请稍后再试');
      expect(screen.queryByText('你没有权限这样做')).not.toBeInTheDocument();
      expect(screen.queryByText('登录已失效，请重新登录')).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain(SERVER_TEXT);
      view.unmount();
    }

    rootStore.locale.setLocale('en-US');
    seriesQuery.error = { message: SERVER_TEXT, data: { code: 'FORBIDDEN', appCode: 'FORBIDDEN' } };
    const forbidden = renderSeries();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again later.');
    expect(screen.queryByText("You don't have permission to do that.")).not.toBeInTheDocument();
    expect(screen.queryByText('Your session has ended. Sign in again.')).not.toBeInTheDocument();
    forbidden.unmount();

    seriesQuery.error = { message: SERVER_TEXT };
    renderSeries();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again later.');
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });

  it('shows the skeleton while loading and no alert', () => {
    seriesQuery.isLoading = true;
    seriesQuery.isPending = true;
    seriesQuery.isFetching = true;
    seriesQuery.isError = false;
    seriesQuery.error = null;
    seriesQuery.errorUpdateCount = 0;
    renderSeries();

    expect(document.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('meta[name="description"]')).toBeNull();
  });

  it('keeps the alert while a retry is in flight and does not disable the button', () => {
    seriesQuery.isPending = true;
    seriesQuery.isFetching = true;
    seriesQuery.isLoading = false;
    seriesQuery.isError = false;
    seriesQuery.errorUpdateCount = 1;
    seriesQuery.dataUpdatedAt = 0;
    renderSeries();

    const button = screen.getByRole('button', { name: '重试中…' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
    expect(document.querySelector('.h-48')).toBeNull();
    expect(document.querySelector('meta[name="description"]')).toBeNull();
  });

  it('does not move focus on the first error', () => {
    const before = document.createElement('button');
    before.type = 'button';
    before.textContent = 'before';
    document.body.appendChild(before);
    before.focus();

    renderSeries();

    expect(document.activeElement).toBe(before);
    expect(screen.getByRole('button', { name: '重试' })).not.toHaveFocus();
    before.remove();
  });

  it('returns focus to Retry after a failed retry', async () => {
    const user = userEvent.setup();
    seriesQuery.refetch = () => {
      seriesQuery.isFetching = true;
      seriesQuery.isPending = true;
      seriesQuery.isError = false;
      seriesQuery.error = null;
      bus.emit();
    };
    renderSeries();

    await user.click(screen.getByRole('button', { name: '重试' }));
    const busy = screen.getByRole('button', { name: '重试中…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveFocus();

    await act(async () => {
      seriesQuery.isFetching = false;
      seriesQuery.isPending = false;
      seriesQuery.isError = true;
      seriesQuery.error = {
        message: SERVER_TEXT,
        data: { code: 'INTERNAL_SERVER_ERROR', appCode: 'INTERNAL_SERVER_ERROR' },
      };
      seriesQuery.errorUpdateCount = 2;
      bus.emit();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '重试' })).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
  });

  it('moves focus to the series title after a successful retry', async () => {
    const user = userEvent.setup();
    seriesQuery.refetch = () => {
      seriesQuery.data = series;
      seriesQuery.isLoading = false;
      seriesQuery.isPending = false;
      seriesQuery.isFetching = false;
      seriesQuery.isError = false;
      seriesQuery.error = null;
      seriesQuery.dataUpdatedAt = 2;
      bus.emit();
    };
    renderSeries();

    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(document.activeElement).toHaveTextContent('天穹黎明');
    });
    expect(document.activeElement?.tagName).toBe('H1');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});

describe('series detail meta description', () => {
  function showSeries() {
    seriesQuery.data = series;
    seriesQuery.isLoading = false;
    seriesQuery.isPending = false;
    seriesQuery.isFetching = false;
    seriesQuery.isError = false;
    seriesQuery.error = null;
    seriesQuery.dataUpdatedAt = 1;
  }

  it('describes the loaded series in Chinese and English', () => {
    showSeries();
    const view = renderSeries();

    expect(document.title).toBe('天穹黎明 · Cardhub');
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      '天穹黎明 系列，共 1 张卡牌。在 Cardhub 查看卡牌资料和讨论。 黎明。',
    );

    view.unmount();
    rootStore.locale.setLocale('en-US');
    renderSeries();
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      '天穹黎明: 1 cards. See card details and discussion on Cardhub. 黎明。',
    );
  });

  it('puts the plain text of a Markdown description after the template', () => {
    series.description = `# 标题\n\n**这是一段足够长的第一句**。\n\n${'后续'.repeat(40)}`;
    showSeries();
    renderSeries();

    const content = document.querySelector('meta[name="description"]')?.getAttribute('content');
    expect(content).toBe(
      '天穹黎明 系列，共 1 张卡牌。在 Cardhub 查看卡牌资料和讨论。 标题 这是一段足够长的第一句。…',
    );
    expect(content).not.toContain('#');
    expect(content).not.toContain('**');
  });
});
