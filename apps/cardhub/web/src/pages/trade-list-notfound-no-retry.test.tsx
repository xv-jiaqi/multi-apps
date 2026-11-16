import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TrpcProvider } from '../lib/trpc';
import { rootStore } from '../stores/root-store';
import { TradeListPage } from './trade-list';
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
          data: { code, httpStatus, path: 'listings.list' },
        },
      },
    ]),
    { status: httpStatus, headers: { 'content-type': 'application/json' } },
  );
}

function mockProcedureErrors(errors: Record<string, TrpcErrorCode>) {
  const calls: Record<string, number> = {};
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const procedure = procedureFromRequest(input);
    calls[procedure] = (calls[procedure] ?? 0) + 1;
    const code = errors[procedure];
    if (!code) {
      throw new Error(`unmocked tRPC procedure: ${procedure}`);
    }
    return trpcBatchError(code);
  });
  vi.stubGlobal('fetch', fetch);
  return { count: (procedure: string) => calls[procedure] ?? 0 };
}

function renderTrade() {
  return render(
    <TrpcProvider>
      <MemoryRouter initialEntries={['/trade']}>
        <Routes>
          <Route path="/trade" element={<TradeListPage />} />
        </Routes>
      </MemoryRouter>
    </TrpcProvider>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  useFakeRetryClock();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('trade list listings.list retry matches the global NOT_FOUND rule', () => {
  it('does not retry listings.list on NOT_FOUND and requests once', async () => {
    const api = mockProcedureErrors({ 'listings.list': 'NOT_FOUND' });
    renderTrade();

    await untilBeforeRetryDelay(() => expect(screen.getByText('加载失败')).toBeInTheDocument());
    expect(api.count('listings.list')).toBe(1);

    await vi.advanceTimersByTimeAsync(PAST_RETRY_DELAY_MS);
    expect(api.count('listings.list')).toBe(1);
  });

  it('still retries listings.list once after a 500, two requests in all', async () => {
    const api = mockProcedureErrors({ 'listings.list': 'INTERNAL_SERVER_ERROR' });
    renderTrade();

    await untilBeforeRetryDelay(() => expect(api.count('listings.list')).toBe(1));
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(PAST_RETRY_DELAY_MS);
    await untilBeforeRetryDelay(() => expect(screen.getByText('加载失败')).toBeInTheDocument());
    expect(api.count('listings.list')).toBe(2);

    await vi.advanceTimersByTimeAsync(PAST_RETRY_DELAY_MS);
    expect(api.count('listings.list')).toBe(2);
  });
});
