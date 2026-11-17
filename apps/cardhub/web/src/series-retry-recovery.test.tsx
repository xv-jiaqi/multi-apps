import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { TrpcProvider } from './lib/trpc';
import { rootStore } from './stores/root-store';
import { appRoutes } from './app';
import { LIST, SERIES } from '../test/trpc-stub';

// Reviewer repro (周扒皮, PR #288): API outage, both series queries 5xx,
// then the API recovers and the user presses the page's single 重试 button.
let healthy = false;
const calls: string[] = [];
beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  healthy = false;
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      const procs = url.pathname.replace(/^.*\/trpc\//, '').split(',');
      calls.push(`${healthy ? 'up' : 'down'}:${procs.join(',')}`);
      const items = procs.map((p) =>
        healthy
          ? {
              result: {
                data: p === 'series.bySlug' ? SERIES : p === 'cards.listBySeries' ? LIST : [],
              },
            }
          : {
              error: {
                message: 'boom',
                code: -32603,
                data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: p },
              },
            },
      );
      return new Response(JSON.stringify(items), {
        status: healthy ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('series page recovers after an outage with one retry', () => {
  it('shows the first card after one 重试 press', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/series/ptcg-sc-csv10'] });
    render(
      <TrpcProvider>
        <RouterProvider router={router} />
      </TrpcProvider>,
    );
    const downs = (proc: string) =>
      calls.filter((c) => c.startsWith('down:') && c.includes(proc)).length;
    await waitFor(
      () => {
        expect(downs('series.bySlug')).toBe(2);
        expect(downs('cards.listBySeries')).toBe(2);
      },
      { timeout: 8000 },
    );
    await new Promise((r) => setTimeout(r, 300));
    const retry = screen.getAllByRole('button', { name: /重试/ })[0]!;
    healthy = true;
    fireEvent.click(retry);
    await waitFor(
      () => expect(screen.getByRole('heading', { level: 1, name: /共逐荣光/ })).toBeInTheDocument(),
      { timeout: 4000 },
    );
    await new Promise((r) => setTimeout(r, 1500));
    expect(screen.queryByRole('link', { name: /阿响的凯罗斯/ })).toBeInTheDocument();
  }, 20000);
});
