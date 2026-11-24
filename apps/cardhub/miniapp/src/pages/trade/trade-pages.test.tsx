// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/components', () => import('../../test-stubs/taro-dom'));

const lifecycle = vi.hoisted(() => ({
  didShow: undefined as undefined | (() => void),
  pullDown: undefined as undefined | (() => void),
  cardSlug: 'aurora-knight',
}));

const taro = vi.hoisted(() => ({
  showToast: vi.fn(async () => undefined),
  setNavigationBarTitle: vi.fn(async () => undefined),
  navigateTo: vi.fn(async () => undefined),
  redirectTo: vi.fn(async () => undefined),
  switchTab: vi.fn(async () => undefined),
  navigateBack: vi.fn(async () => undefined),
  getCurrentPages: vi.fn(() => [{}, {}]),
  stopPullDownRefresh: vi.fn(async () => undefined),
  pxTransform: (size: number) => `${size}px`,
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
  getEnv: () => 'WEB',
  ENV_TYPE: { WEB: 'WEB', WEAPP: 'WEAPP' },
}));

vi.mock('@tarojs/taro', () => ({
  default: taro,
  ...taro,
  useDidHide: () => undefined,
  useDidShow: (fn: () => void) => {
    lifecycle.didShow = fn;
  },
  usePullDownRefresh: (fn: () => void) => {
    lifecycle.pullDown = fn;
  },
  useRouter: () => ({ params: { cardSlug: lifecycle.cardSlug } }),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  publish: vi.fn(),
  search: vi.fn(),
  bySlug: vi.fn(),
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    listings: {
      list: { query: api.list },
      publish: { mutate: api.publish },
    },
    cards: {
      search: { query: api.search },
      bySlug: { query: api.bySlug },
    },
  },
}));

const stores = vi.hoisted(() => ({
  locale: { locale: 'zh-CN' as const },
  session: {
    token: 'session-token',
    isAuthenticated: true,
  },
}));

vi.mock('../../stores/root-store', () => ({ useStores: () => stores }));
vi.mock('../../lib/apply-tab-bar-labels', () => ({ applyTabBarLabels: vi.fn() }));

import TradeListPage from './list/index';
import TradePublishPage from './publish/index';
import { ListingRow, type ListingItem } from '../../components/listing-row';
import { markListNeedsRefresh, resetListRefreshFlags } from '../../lib/list-refresh';
import { forgetAllListSessions } from '../../lib/list-session';
import { resetQueuedStatusToast } from '../../lib/status-toast';
import { LISTING_IMAGE_MAX_COUNT, LISTING_IMAGE_URL_MAX } from '@repo/shared';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function listing(i: number, kind: 'SELL' | 'BUY' = i % 2 === 0 ? 'SELL' : 'BUY') {
  return {
    id: `l${String(i).padStart(3, '0')}`,
    cardSlug: `card-${i}`,
    card: {
      slug: `card-${i}`,
      name: `卡${i}`,
      imageUrl: null,
      seriesSlug: 'aurora',
      seriesTitle: '极光',
    },
    kind,
    price: kind === 'SELL' ? `${100 + i}.00` : null,
    currency: 'CNY',
    imageUrls: [] as string[],
    contact: 'wx: bob123',
    note: i === 1 ? '第一行\n第二行' : null,
    condition: 'NM',
    language: 'ZH',
    variantNote: null as string | null,
    status: 'OPEN',
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-20T08:00:00.000Z',
    seller: { id: 'u2', username: 'bob' },
    safetyStatus: 'pass' as const,
  };
}

async function showList() {
  const view = render(<TradeListPage />);
  await act(async () => {
    lifecycle.didShow?.();
  });
  return view;
}

afterEach(() => {
  cleanup();
  lifecycle.didShow = undefined;
  stores.session.isAuthenticated = true;
  resetListRefreshFlags();
  forgetAllListSessions();
  resetQueuedStatusToast();
});

beforeEach(() => {
  stores.session.isAuthenticated = true;
  api.list.mockReset();
  api.publish.mockReset();
  api.search.mockReset();
  api.bySlug.mockReset();
  api.bySlug.mockResolvedValue({
    slug: 'aurora-knight',
    name: '极光骑士',
    imageUrl: null,
    seriesTitle: '极光',
  });
  taro.showToast.mockReset();
  taro.redirectTo.mockReset();
  taro.navigateTo.mockReset();
  taro.switchTab.mockReset();
  taro.navigateBack.mockReset();
  taro.getCurrentPages.mockReturnValue([{}, {}] as never);
});

describe('trade list load and return (CH-301 v1.5)', () => {
  it('sends a single first-page request on first show (no useEffect+useDidShow double fetch)', async () => {
    api.list.mockResolvedValue({ items: [listing(1)], nextCursor: null });
    await showList();
    await screen.findByText('卡1');
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list.mock.calls[0]?.[0]?.cursor).toBeUndefined();
  });

  it('keeps loaded items when shown again without a new post', async () => {
    api.list.mockResolvedValue({ items: [listing(1)], nextCursor: null });
    await showList();
    await screen.findByText('卡1');
    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(screen.getByText('卡1')).toBeTruthy();
  });

  it('reloads page 1 after a successful submit when the list is shown again', async () => {
    const first = deferred<{ items: ReturnType<typeof listing>[]; nextCursor: string | null }>();
    const fresh = deferred<{ items: ReturnType<typeof listing>[]; nextCursor: string | null }>();
    api.list
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => fresh.promise);
    await showList();
    await act(async () => {
      first.resolve({ items: [listing(1)], nextCursor: null });
      await first.promise;
    });
    markListNeedsRefresh('trade');
    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(api.list).toHaveBeenCalledTimes(2);
    await act(async () => {
      fresh.resolve({ items: [listing(9)], nextCursor: null });
      await fresh.promise;
    });
    expect(screen.getByText('卡9')).toBeTruthy();
  });

  it('disables load-more and does not use the stale cursor while a filter refresh is in flight', async () => {
    const first = deferred<{ items: ReturnType<typeof listing>[]; nextCursor: string | null }>();
    const sellPage = deferred<{ items: ReturnType<typeof listing>[]; nextCursor: string | null }>();
    api.list
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => sellPage.promise);
    await showList();
    await act(async () => {
      first.resolve({
        items: Array.from({ length: 20 }, (_, i) => listing(i)),
        nextCursor: 'l019',
      });
      await first.promise;
    });
    const sellChip = screen.getByRole('button', { name: '出' });
    act(() => {
      sellChip.click();
    });
    expect(
      sellChip.className.includes('trade-filters__chip--active') ||
        sellChip.getAttribute('aria-pressed') === 'true',
    ).toBe(true);
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.list.mock.calls[1]?.[0]?.kind).toBe('SELL');
    expect(api.list.mock.calls[1]?.[0]?.cursor).toBeUndefined();
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
    expect(screen.queryByText('卡1')).toBeNull();
    await act(async () => {
      sellPage.resolve({ items: [listing(40, 'SELL')], nextCursor: null });
      await sellPage.promise;
    });
    expect(screen.getByText('卡40')).toBeTruthy();
    expect(screen.queryByText('卡1')).toBeNull();
  });

  it('same-tick load-more clicks send one request and do not duplicate rows', async () => {
    const first = deferred<{ items: ReturnType<typeof listing>[]; nextCursor: string | null }>();
    const second = deferred<{ items: ReturnType<typeof listing>[]; nextCursor: string | null }>();
    api.list
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    await showList();
    await act(async () => {
      first.resolve({
        items: Array.from({ length: 20 }, (_, i) => listing(i)),
        nextCursor: 'c20',
      });
      await first.promise;
    });
    const button = await screen.findByRole('button', { name: '加载更多' });
    act(() => {
      button.click();
      button.click();
      button.click();
      button.click();
      button.click();
    });
    expect(api.list.mock.calls.filter((call) => call[0]?.cursor === 'c20')).toHaveLength(1);
    await act(async () => {
      second.resolve({ items: [listing(20), listing(21)], nextCursor: null });
      await second.promise;
    });
    const names = screen.getAllByText(/卡\d+/).map((el) => el.textContent);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('trade publish safety, note, and limits', () => {
  it('switchTabs to the list and does not claim a public post when publish returns unchecked', async () => {
    api.bySlug.mockResolvedValue({
      slug: 'aurora-knight',
      name: '极光骑士',
      imageUrl: null,
      seriesTitle: '极光',
    });
    api.publish.mockResolvedValue({ id: 'new', safetyStatus: 'unchecked' });
    render(<TradePublishPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    await screen.findByText('极光骑士');
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const contact = inputs.find((el) => el.getAttribute('maxlength') === '200');
    expect(contact).toBeTruthy();
    fireEvent.change(contact!, { target: { value: 'wx: me' } });
    const submit = document.querySelector('button.primary-button') as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    await waitFor(() => expect(api.publish).toHaveBeenCalledTimes(1));
    expect(taro.switchTab).toHaveBeenCalledWith({ url: '/pages/trade/list/index' });
    expect(api.publish.mock.calls[0]?.[0]).toMatchObject({ cardSlug: 'aurora-knight' });
  });

  it('caps the photo-link textarea at 4 × 2048 plus newlines and includes a 500-char note field', async () => {
    api.bySlug.mockResolvedValue({
      slug: 'aurora-knight',
      name: '极光骑士',
      imageUrl: null,
      seriesTitle: '极光',
    });
    render(<TradePublishPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    await screen.findByText('极光骑士');
    expect(screen.getByText('备注（可选，最多 500 字）')).toBeTruthy();
    expect(screen.queryByText(/只有登录用户才能看到/)).toBeNull();
    expect(screen.queryByText(/Only signed-in/)).toBeNull();
    const areas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    const imageArea = areas.find(
      (el) =>
        el.getAttribute('maxlength') ===
        String(LISTING_IMAGE_MAX_COUNT * LISTING_IMAGE_URL_MAX + (LISTING_IMAGE_MAX_COUNT - 1)),
    );
    const noteArea = areas.find((el) => el.getAttribute('maxlength') === '500');
    expect(imageArea).toBeTruthy();
    expect(noteArea).toBeTruthy();
  });

  it('navigates to login only once when opened while signed out', async () => {
    stores.session.isAuthenticated = false;
    render(<TradePublishPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(taro.navigateTo).toHaveBeenCalledTimes(1);
    expect(taro.navigateTo).toHaveBeenCalledWith({ url: '/pages/auth/login/index' });
    expect(taro.redirectTo).not.toHaveBeenCalled();
    await act(async () => {
      lifecycle.didShow?.();
    });
    expect(taro.navigateTo).toHaveBeenCalledTimes(1);
  });
});

describe('listing row (CH-301 §3 v1.5)', () => {
  it('shows a login link when contact is null and keeps note line breaks', () => {
    const row = listing(1);
    const view = render(
      <ListingRow
        listing={
          {
            ...row,
            contact: null as unknown as string,
            note: '第一行\n第二行',
            safetyStatus: 'review',
          } as ListingItem
        }
        locale="zh-CN"
      />,
    );
    expect(view.container.textContent).toContain('登录后查看联系方式');
    expect(view.container.textContent).toContain('备注');
    expect(view.container.textContent).toContain('第一行');
    expect(view.container.textContent).toContain('第二行');
    expect(view.container.textContent).toContain('审核中');
    const link = view.container.querySelector('a, [href], .listing-row__signin');
    expect(link).toBeTruthy();
  });
});
