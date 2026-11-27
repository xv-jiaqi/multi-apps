import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { stubApi } from '../../test/trpc-stub';
import { listenForCrossTabSessionChanges } from '../lib/session-cross-tab';
import { TrpcProvider } from '../lib/trpc';
import { SESSION_KEY, rootStore } from '../stores/root-store';
import { PageShell } from '../components/page-shell';
import { ListingsForCard } from '../components/listings-for-card';
import { TradeListPage } from './trade-list';

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = vi.fn();
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}
if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

const CONTACT = '微信 ch250-signout-secret';
const CARD_SLUG = 'aurora-knight';

function listing(contact: string | null) {
  return {
    id: 'l-signout',
    cardSlug: CARD_SLUG,
    card: {
      slug: CARD_SLUG,
      name: '极光骑士',
      imageUrl: null,
      seriesSlug: 'starter',
      seriesTitle: '启程',
    },
    kind: 'SELL' as const,
    price: '10.00',
    currency: 'CNY',
    imageUrls: [] as string[],
    contact,
    note: null,
    condition: null,
    language: null,
    variantNote: null,
    status: 'OPEN' as const,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    seller: { id: 'seller', username: 'seller' },
  };
}

function mockListingsApi() {
  return stubApi((procedure) => {
    const contact = rootStore.session.isAuthenticated ? CONTACT : null;
    if (procedure === 'listings.list') {
      return { data: { items: [listing(contact)], nextCursor: null } };
    }
    if (procedure === 'listings.byCard') {
      return { data: [listing(contact)] };
    }
    if (procedure === 'notifications.unreadCount') {
      return { data: { count: 0 } };
    }
    if (procedure === 'search.global') {
      return { data: { cards: [], series: [] } };
    }
    throw new Error(`unmocked tRPC procedure: ${procedure}`);
  });
}

function renderApp(initialPath: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Outlet />,
        children: [
          {
            index: true,
            element: (
              <PageShell>
                <p>首页</p>
              </PageShell>
            ),
          },
          { path: 'trade', element: <TradeListPage /> },
          {
            path: 'cards/:slug',
            element: (
              <PageShell>
                <ListingsForCard cardSlug={CARD_SLUG} />
              </PageShell>
            ),
          },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  const view = render(
    <TrpcProvider>
      <RouterProvider router={router} />
    </TrpcProvider>,
  );
  return { router, ...view };
}

function signOutFromHeader() {
  const logout = screen.getByRole('button', { name: '退出登录' });
  fireEvent.click(logout);
}

async function goToTrade() {
  const trade = [...document.querySelectorAll('a[href="/trade"]')].find(
    (link) => link instanceof HTMLAnchorElement && link.closest('header'),
  );
  if (!(trade instanceof HTMLAnchorElement)) throw new Error('没有交易入口');
  fireEvent.click(trade);
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
});

afterEach(() => {
  vi.unstubAllGlobals();
  rootStore.session.signOut();
});

describe('sign-out listings cache (CH-250 §2-2)', () => {
  it('does not show a cached contact on /trade, the card page, or back after sign-out', async () => {
    mockListingsApi();
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    const { router } = renderApp('/trade');

    expect(await screen.findByText(CONTACT, { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '登录后查看联系方式' })).not.toBeInTheDocument();

    // The card page renders the contact inside "@seller · contact", so match a
    // substring. Wait for each route to render first: right after navigate() the
    // previous page is still mounted, and findByText could return its node
    // before React unmounts it.
    await router.navigate(`/cards/${CARD_SLUG}`);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '交易意向板' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(CONTACT, { exact: false })).toBeInTheDocument();

    await router.navigate('/trade');
    expect(await screen.findByRole('heading', { name: '交易意向板' })).toBeInTheDocument();
    expect(await screen.findByText(CONTACT, { exact: false })).toBeInTheDocument();

    signOutFromHeader();
    expect(rootStore.session.isAuthenticated).toBe(false);
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByText(CONTACT, { exact: false })).not.toBeInTheDocument();

    // Browser back returns to the trade list immediately after sign-out.
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/trade');
    expect(
      await screen.findByRole('heading', { name: '交易意向板' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(CONTACT, { exact: false })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录后查看联系方式' })).toBeInTheDocument();

    await router.navigate(`/cards/${CARD_SLUG}`);
    expect(await screen.findByRole('link', { name: '登录后查看联系方式' })).toBeInTheDocument();
    expect(screen.queryByText(CONTACT, { exact: false })).not.toBeInTheDocument();

    // Clicking 交易 from the card page (or after going home) also stays clean.
    goToTrade();
    expect(router.state.location.pathname).toBe('/trade');
    expect(await screen.findByRole('heading', { name: '交易意向板' })).toBeInTheDocument();
    expect(screen.queryByText(CONTACT, { exact: false })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录后查看联系方式' })).toBeInTheDocument();
  });

  it('clears a cached contact in this tab when another tab signs out', async () => {
    mockListingsApi();
    const stop = listenForCrossTabSessionChanges();
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    renderApp('/trade');
    expect(await screen.findByText(CONTACT, { exact: false })).toBeInTheDocument();

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: SESSION_KEY,
        oldValue: 'token',
        newValue: null,
        storageArea: window.localStorage,
      }),
    );

    expect(rootStore.session.isAuthenticated).toBe(false);
    expect(await screen.findByRole('link', { name: '登录后查看联系方式' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(CONTACT, { exact: false })).not.toBeInTheDocument(),
    );
    stop();
  });
});
