import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TrpcProvider } from '../lib/trpc';
import { rootStore } from '../stores/root-store';
import { CardDetailPage } from './card-detail';
import { SeriesDetailPage } from './series-detail';

type TrpcErrorCode = 'NOT_FOUND' | 'INTERNAL_SERVER_ERROR';

const RPC_CODE: Record<TrpcErrorCode, number> = {
  NOT_FOUND: -32004,
  INTERNAL_SERVER_ERROR: -32603,
};

function procedureFromRequest(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = raw.replace(/^[a-z]+:\/\/[^/]+/i, '');
  const match = path.match(/^\/trpc\/([^/?]+)/);
  if (!match?.[1]) {
    throw new Error(`unexpected tRPC request: ${raw}`);
  }
  return match[1];
}

function trpcBatchError(code: TrpcErrorCode): Response {
  const httpStatus = code === 'NOT_FOUND' ? 404 : 500;
  return new Response(
    JSON.stringify([
      {
        error: {
          message: code,
          code: RPC_CODE[code],
          data: { code, httpStatus, path: 'test' },
        },
      },
    ]),
    { status: httpStatus, headers: { 'content-type': 'application/json' } },
  );
}

function mockProcedureErrors(errors: Record<string, TrpcErrorCode>) {
  const calls: Record<string, number> = {};
  let firstResponseAt: number | undefined;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const procedure = procedureFromRequest(input);
    calls[procedure] = (calls[procedure] ?? 0) + 1;
    const code = errors[procedure];
    if (!code) {
      throw new Error(`unmocked tRPC procedure: ${procedure}`);
    }
    const response = trpcBatchError(code);
    firstResponseAt ??= performance.now();
    return response;
  });
  vi.stubGlobal('fetch', fetch);
  return {
    count: (procedure: string) => calls[procedure] ?? 0,
    firstResponseAt: () => firstResponseAt,
  };
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cut-6 AC6-11: missing card and series do not retry NOT_FOUND', () => {
  it('shows 内容不存在 within 1s of a card NOT_FOUND and requests once', async () => {
    const api = mockProcedureErrors({ 'cards.bySlug': 'NOT_FOUND' });
    renderCard('ptcg-sc-no-such-card');

    const copy = await screen.findByText('内容不存在', {}, { timeout: 1500 });
    const respondedAt = api.firstResponseAt();
    expect(respondedAt).toBeDefined();
    expect(performance.now() - respondedAt!).toBeLessThanOrEqual(1000);
    expect(copy).toBeInTheDocument();
    expect(api.count('cards.bySlug')).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(api.count('cards.bySlug')).toBe(1);
  });

  it('shows 内容不存在 within 1s of a series NOT_FOUND and requests once', async () => {
    const api = mockProcedureErrors({ 'series.bySlug': 'NOT_FOUND' });
    renderSeries('no-such-series');

    const copy = await screen.findByText('内容不存在', {}, { timeout: 1500 });
    const respondedAt = api.firstResponseAt();
    expect(respondedAt).toBeDefined();
    expect(performance.now() - respondedAt!).toBeLessThanOrEqual(1000);
    expect(copy).toBeInTheDocument();
    expect(api.count('series.bySlug')).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(api.count('series.bySlug')).toBe(1);
  });

  it('still retries a card query after a 500', async () => {
    const api = mockProcedureErrors({ 'cards.bySlug': 'INTERNAL_SERVER_ERROR' });
    renderCard('ptcg-sc-no-such-card');

    await waitFor(() => expect(api.count('cards.bySlug')).toBeGreaterThan(1), { timeout: 3000 });
    expect(screen.queryByText('内容不存在')).not.toBeInTheDocument();
  });

  it('still retries a series query after a 500', async () => {
    const api = mockProcedureErrors({ 'series.bySlug': 'INTERNAL_SERVER_ERROR' });
    renderSeries('no-such-series');

    await waitFor(() => expect(api.count('series.bySlug')).toBeGreaterThan(1), { timeout: 3000 });
    expect(screen.queryByText('内容不存在')).not.toBeInTheDocument();
  });
});
