import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { TrpcProvider } from './lib/trpc';
import { rootStore } from './stores/root-store';
import type * as SeriesDetailModule from './pages/series-detail';

/**
 * cut-6 AC6-11 with the CH-240 prefetch: NOT_FOUND arrives before the
 * series-detail chunk, and mounting the page must not ask again.
 */
const chunk = vi.hoisted(() => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { gate, open: () => open() };
});

vi.mock('./pages/series-detail', async (importOriginal) => {
  await chunk.gate;
  return importOriginal<typeof SeriesDetailModule>();
});

import { appRoutes } from './app';
import { stubApi } from '../test/trpc-stub';

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('series page NOT_FOUND with the route prefetch (cut-6 AC6-11)', () => {
  it('shows 内容不存在 and requests each query once when NOT_FOUND lands before the chunk', async () => {
    const api = stubApi(() => ({ notFound: true }));
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/series/no-such-series'] });
    render(
      <TrpcProvider>
        <RouterProvider router={router} />
      </TrpcProvider>,
    );

    await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
    // Let the NOT_FOUND response settle in the cache before the page mounts.
    await new Promise((resolve) => setTimeout(resolve, 50));
    chunk.open();

    expect(await screen.findByText('内容不存在')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.count('series.bySlug')).toBe(1);
    expect(api.count('cards.listBySeries')).toBe(1);
  });
});
