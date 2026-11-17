import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { TrpcProvider } from './lib/trpc';
import { rootStore } from './stores/root-store';
import type * as SeriesDetailModule from './pages/series-detail';

/**
 * CH-240 first card: the series page asks for its data while the
 * series-detail chunk is still downloading, not after it mounts.
 * The chunk is held back with a gate so "still downloading" is a fixed state.
 */
const chunk = vi.hoisted(() => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { gate, open: () => open(), loaded: false };
});

vi.mock('./pages/series-detail', async (importOriginal) => {
  await chunk.gate;
  const mod = await importOriginal<typeof SeriesDetailModule>();
  chunk.loaded = true;
  return mod;
});

import { appRoutes } from './app';
import { LIST, SERIES, stubApi } from '../test/trpc-stub';

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(
    <TrpcProvider>
      <RouterProvider router={router} />
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

describe('series page first card (CH-240 v1.1, cut-7 AC7-11)', () => {
  it('requests the series and its first card page before the page chunk loads, once each', async () => {
    const api = stubApi((procedure) => {
      if (procedure === 'series.bySlug') return { data: SERIES };
      if (procedure === 'cards.listBySeries') return { data: LIST };
      return { data: [] };
    });
    renderAt('/series/ptcg-sc-csv10?sort=name');

    await waitFor(() => {
      expect(api.count('series.bySlug')).toBe(1);
      expect(api.count('cards.listBySeries')).toBe(1);
    });
    expect(chunk.loaded).toBe(false);
    // Same inputs the page uses, so the page reads them from the cache.
    const sent = api.requests.find((r) => r.procedures.includes('cards.listBySeries'));
    expect(sent?.inputs['cards.listBySeries']).toEqual({
      seriesSlug: 'ptcg-sc-csv10',
      page: 1,
      pageSize: 60,
      sort: 'name',
    });
    const bySlug = api.requests.find((r) => r.procedures.includes('series.bySlug'));
    expect(bySlug?.inputs['series.bySlug']).toEqual({ slug: 'ptcg-sc-csv10', includeCards: false });

    chunk.open();
    expect(await screen.findByRole('link', { name: /阿响的凯罗斯/ })).toBeInTheDocument();
    expect(api.count('series.bySlug')).toBe(1);
    expect(api.count('cards.listBySeries')).toBe(1);
  });
});
