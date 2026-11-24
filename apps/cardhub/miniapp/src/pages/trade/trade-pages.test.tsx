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
    user: { id: 'alice', username: 'alice' } as { id: string; username: string } | null,
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
  lifecycle.cardSlug = 'aurora-knight';
  stores.session.isAuthenticated = true;
  stores.session.user = { id: 'alice', username: 'alice' };
  stores.session.token = 'session-token';
  resetListRefreshFlags();
  forgetAllListSessions();
  resetQueuedStatusToast();
});

beforeEach(() => {
  stores.session.isAuthenticated = true;
  stores.session.user = { id: 'alice', username: 'alice' };
  stores.session.token = 'session-token';
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
    expect(screen.getByText('联系方式请填在「联系方式」栏')).toBeTruthy();
    const hint = document.getElementById('trade-publish-note-hint');
    expect(hint).toBeTruthy();
    expect(hint?.className).toContain('trade-form__hint');
    expect(noteArea?.getAttribute('aria-describedby')).toBe('trade-publish-note-hint');
  });

  it('navigates to login only once when opened while signed out', async () => {
    stores.session.isAuthenticated = false;
    stores.session.user = null;
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

describe('listing row (CH-301 §3 v1.9)', () => {
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

  it('hides the note row and its label when note is null or only whitespace', () => {
    for (const note of [null, '', '   ', '\n\t']) {
      const view = render(
        <ListingRow
          listing={
            {
              ...listing(2),
              contact: null as unknown as string,
              note: note as unknown as string,
            } as ListingItem
          }
          locale="zh-CN"
        />,
      );
      expect(view.container.textContent).toContain('登录后查看联系方式');
      expect(view.container.textContent).not.toContain('备注');
      expect(view.container.querySelectorAll('.listing-row__signin').length).toBe(1);
      expect(view.container.querySelector('.listing-row__note')).toBeNull();
      view.unmount();
    }
  });

  it('gives https listing photos an accessible name from trade.list.photoFallback', () => {
    const view = render(
      <ListingRow
        listing={
          {
            ...listing(1),
            imageUrls: ['https://img.cardhub.test/a.png', 'http://insecure.example/b.png'],
          } as ListingItem
        }
        locale="zh-CN"
      />,
    );
    const img = view.container.querySelector('img.listing-row__photo') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img?.getAttribute('alt')).toBe('图片 1');
    expect(view.container.textContent).toContain('图片 2');
  });
});

describe('trade list account switch and publish a11y', () => {
  it("does not reuse the previous user's pending listings after an account switch", async () => {
    api.list.mockResolvedValueOnce({
      items: [
        {
          ...listing(1),
          safetyStatus: 'review' as const,
          seller: { id: 'alice', username: 'alice' },
        },
      ],
      nextCursor: null,
    });
    const first = await showList();
    await screen.findByText('卡1');
    expect(screen.getByText('审核中')).toBeTruthy();
    expect(api.list).toHaveBeenCalledTimes(1);
    first.unmount();

    stores.session.user = { id: 'bob', username: 'bob' };
    api.list.mockResolvedValueOnce({ items: [listing(8)], nextCursor: null });
    await showList();
    await screen.findByText('卡8');
    expect(screen.queryByText('卡1')).toBeNull();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('refetches and drops the cached list after sign-out', async () => {
    api.list.mockResolvedValueOnce({
      items: [{ ...listing(1), safetyStatus: 'review' as const }],
      nextCursor: null,
    });
    const first = await showList();
    await screen.findByText('卡1');
    first.unmount();

    stores.session.isAuthenticated = false;
    stores.session.user = null;
    api.list.mockResolvedValueOnce({ items: [listing(3)], nextCursor: null });
    await showList();
    await screen.findByText('卡3');
    expect(screen.queryByText('卡1')).toBeNull();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('keeps the publish button locked after a successful post so a second click does not publish again', async () => {
    api.publish.mockResolvedValue({ id: 'new', safetyStatus: 'unchecked' });
    render(<TradePublishPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    await screen.findByText('极光骑士');
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const contact = inputs.find((el) => el.getAttribute('maxlength') === '200');
    fireEvent.change(contact!, { target: { value: 'wx: me' } });
    const submit = document.querySelector('button.primary-button') as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    await waitFor(() => expect(api.publish).toHaveBeenCalledTimes(1));
    expect(submit.disabled || submit.getAttribute('aria-disabled') === 'true').toBe(true);
    await act(async () => {
      submit.click();
    });
    expect(api.publish).toHaveBeenCalledTimes(1);
  });

  it('associates price, contact, note, card search, variant note and images with visible labels', async () => {
    lifecycle.cardSlug = '';
    api.bySlug.mockReset();
    render(<TradePublishPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });

    const labelled = (labelId: string, tag: 'input' | 'textarea') => {
      const label = document.getElementById(labelId);
      expect(label, labelId).toBeTruthy();
      const control = document.querySelector(`${tag}[aria-labelledby="${labelId}"]`);
      expect(control, `${tag} for ${labelId}`).toBeTruthy();
      return control as HTMLElement;
    };

    labelled('trade-publish-card-label', 'input');
    labelled('trade-publish-price-label', 'input');
    labelled('trade-publish-variant-label', 'input');
    labelled('trade-publish-contact-label', 'input');
    const note = labelled('trade-publish-note-label', 'textarea');
    expect(note.getAttribute('aria-describedby')).toContain('trade-publish-note-hint');
    labelled('trade-publish-images-label', 'textarea');

    const price = document.querySelector(
      'input[aria-labelledby="trade-publish-price-label"]',
    ) as HTMLInputElement;
    fireEvent.change(price, { target: { value: 'not-a-price' } });
    const contact = document.querySelector(
      'input[aria-labelledby="trade-publish-contact-label"]',
    ) as HTMLInputElement;
    fireEvent.change(contact, { target: { value: 'x' } });
    const submit = document.querySelector('button.primary-button') as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    await waitFor(() =>
      expect(document.getElementById('trade-publish-contact-error')).toBeTruthy(),
    );
    expect(
      document
        .querySelector('input[aria-labelledby="trade-publish-contact-label"]')
        ?.getAttribute('aria-describedby'),
    ).toBe('trade-publish-contact-error');
    lifecycle.cardSlug = 'aurora-knight';
  });

  it('has no axe label violations on the publish form controls', async () => {
    const axe = await import('axe-core');
    lifecycle.cardSlug = '';
    api.bySlug.mockReset();
    const view = render(<TradePublishPage />);
    await act(async () => {
      lifecycle.didShow?.();
    });
    const results = await axe.default.run(view.container, {
      runOnly: { type: 'rule', values: ['label', 'label-title-only', 'aria-input-field-name'] },
    });
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    lifecycle.cardSlug = 'aurora-knight';
  });
});
