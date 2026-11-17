import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TrpcProvider } from '../lib/trpc';
import { rootStore } from '../stores/root-store';
import { CardDetailPage } from './card-detail';
import { SeriesDetailPage } from './series-detail';
import {
  PAST_RETRY_DELAY_MS,
  untilBeforeRetryDelay,
  useFakeRetryClock,
} from '../../test/retry-clock';

type TrpcErrorCode = 'NOT_FOUND' | 'INTERNAL_SERVER_ERROR';

const RPC_CODE: Record<TrpcErrorCode, number> = {
  NOT_FOUND: -32004,
  INTERNAL_SERVER_ERROR: -32603,
};

function proceduresFromRequest(input: RequestInfo | URL): string[] {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = raw.replace(/^[a-z]+:\/\/[^/]+/i, '');
  const match = path.match(/^\/trpc\/([^/?]+)/);
  if (!match?.[1]) {
    throw new Error(`unexpected tRPC request: ${raw}`);
  }
  return match[1].split(',');
}

function trpcBatchErrors(
  items: ReadonlyArray<{ procedure: string; code: TrpcErrorCode }>,
): Response {
  const hasServerError = items.some((item) => item.code === 'INTERNAL_SERVER_ERROR');
  const httpStatus = hasServerError ? 500 : 404;
  return new Response(
    JSON.stringify(
      items.map((item) => ({
        error: {
          message: item.code,
          code: RPC_CODE[item.code],
          data: { code: item.code, httpStatus, path: item.procedure },
        },
      })),
    ),
    { status: httpStatus, headers: { 'content-type': 'application/json' } },
  );
}

function mockProcedureErrors(errors: Record<string, TrpcErrorCode>) {
  const calls: Record<string, number> = {};
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const procedures = proceduresFromRequest(input);
    const items = procedures.map((procedure) => {
      calls[procedure] = (calls[procedure] ?? 0) + 1;
      const code = errors[procedure];
      if (!code) {
        throw new Error(`unmocked tRPC procedure: ${procedure}`);
      }
      return { procedure, code };
    });
    return trpcBatchErrors(items);
  });
  vi.stubGlobal('fetch', fetch);
  return { count: (procedure: string) => calls[procedure] ?? 0 };
}

function renderCard(slug: string) {
  return render(
    <TrpcProvider>
      <MemoryRouter initialEntries={[`/cards/${slug}`]}>
        <Routes>
          <Route path="/cards/:cardSlug" element={<CardDetailPage />} />
        </Routes>
      </MemoryRouter>
    </TrpcProvider>,
  );
}

function renderSeries(slug: string) {
  return render(
    <TrpcProvider>
      <MemoryRouter initialEntries={[`/series/${slug}`]}>
        <Routes>
          <Route path="/series/:seriesSlug" element={<SeriesDetailPage />} />
        </Routes>
      </MemoryRouter>
    </TrpcProvider>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
});

beforeEach(() => {
  useFakeRetryClock();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('cut-6 AC6-11: missing card and series do not retry NOT_FOUND', () => {
  it('shows 内容不存在 for a card NOT_FOUND before any retry delay and requests once', async () => {
    const api = mockProcedureErrors({ 'cards.bySlug': 'NOT_FOUND' });
    renderCard('ptcg-sc-no-such-card');

    await untilBeforeRetryDelay(() => expect(screen.getByText('内容不存在')).toBeInTheDocument());
    expect(api.count('cards.bySlug')).toBe(1);

    await vi.advanceTimersByTimeAsync(PAST_RETRY_DELAY_MS);
    expect(api.count('cards.bySlug')).toBe(1);
    expect(screen.getByText('内容不存在')).toBeInTheDocument();
  });

  it('shows 内容不存在 for a series NOT_FOUND before any retry delay and requests once', async () => {
    const api = mockProcedureErrors({
      'series.bySlug': 'NOT_FOUND',
      'cards.listBySeries': 'NOT_FOUND',
    });
    renderSeries('no-such-series');

    await untilBeforeRetryDelay(() => expect(screen.getByText('内容不存在')).toBeInTheDocument());
    expect(api.count('series.bySlug')).toBe(1);
    expect(api.count('cards.listBySeries')).toBe(1);

    await vi.advanceTimersByTimeAsync(PAST_RETRY_DELAY_MS);
    expect(api.count('series.bySlug')).toBe(1);
    expect(api.count('cards.listBySeries')).toBe(1);
    expect(screen.getByText('内容不存在')).toBeInTheDocument();
  });

  it('still retries a card query once after a 500', async () => {
    const api = mockProcedureErrors({ 'cards.bySlug': 'INTERNAL_SERVER_ERROR' });
    renderCard('ptcg-sc-no-such-card');

    await untilBeforeRetryDelay(() => expect(api.count('cards.bySlug')).toBe(1));
    await vi.advanceTimersByTimeAsync(PAST_RETRY_DELAY_MS);
    await untilBeforeRetryDelay(() => expect(api.count('cards.bySlug')).toBe(2));
    await vi.advanceTimersByTimeAsync(PAST_RETRY_DELAY_MS);
    expect(api.count('cards.bySlug')).toBe(2);
    expect(screen.queryByText('内容不存在')).not.toBeInTheDocument();
  });

  it('still retries a series query once after a 500', async () => {
    const api = mockProcedureErrors({
      'series.bySlug': 'INTERNAL_SERVER_ERROR',
      'cards.listBySeries': 'INTERNAL_SERVER_ERROR',
    });
    renderSeries('no-such-series');

    await untilBeforeRetryDelay(() => expect(api.count('series.bySlug')).toBe(1));
    await vi.advanceTimersByTimeAsync(PAST_RETRY_DELAY_MS);
    await untilBeforeRetryDelay(() => expect(api.count('series.bySlug')).toBe(2));
    await vi.advanceTimersByTimeAsync(PAST_RETRY_DELAY_MS);
    expect(api.count('series.bySlug')).toBe(2);
    expect(screen.queryByText('内容不存在')).not.toBeInTheDocument();
  });
});
