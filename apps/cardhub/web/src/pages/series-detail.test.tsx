import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';

const SERVER_TEXT = 'Invalid time value';

const seriesQuery: {
  data: undefined;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: { message: string; data?: { code?: string; appCode?: string } } | null;
  errorUpdateCount: number;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
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
        useQuery: () => seriesQuery,
      },
    },
    comments: {
      listForCard: { useQuery: () => seriesQuery },
      listForSeries: { useQuery: () => seriesQuery },
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

function renderSeries(slug = 'celestial-dawn') {
  return render(
    <MemoryRouter initialEntries={[`/series/${slug}`]}>
      <Routes>
        <Route path="/series/:seriesSlug" element={<SeriesDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
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
});

describe('series detail server errors', () => {
  it('shows the localized alert in zh and never the server text', () => {
    renderSeries();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('出了点问题，请稍后再试');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(document.body.textContent).not.toContain('prisma');
    expect(document.title).toBe('出了点问题，请稍后再试 · Cardhub');
    expect(document.title).not.toContain(SERVER_TEXT);
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
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });
});
