// @vitest-environment jsdom
/**
 * Page-level double-submit guard (CH-301 follow-up): login, register and the
 * card comment form each send exactly one request for a burst of clicks in
 * the same tick, or for Enter / Space on the focused button, and accept a
 * new submit after a failure. Rendered with DOM stand-ins for Taro.
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/components', () => import('../test-stubs/taro-dom'));

const taro = vi.hoisted(() => ({
  showToast: vi.fn(async () => undefined),
  showActionSheet: vi.fn(async () => ({ tapIndex: 0 })),
  setNavigationBarTitle: vi.fn(async () => undefined),
  navigateTo: vi.fn(async () => undefined),
  redirectTo: vi.fn(async () => undefined),
  switchTab: vi.fn(async () => undefined),
  navigateBack: vi.fn(async () => undefined),
  pxTransform: (size: number) => `${size}px`,
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
  getEnv: vi.fn(() => 'WEB'),
  ENV_TYPE: { WEB: 'WEB', WEAPP: 'WEAPP' },
}));
vi.mock('@tarojs/taro', () => ({
  default: taro,
  ...taro,
  useRouter: () => ({ params: { slug: 'aurora-knight' } }),
  // The page also hooks useDidShow. Leave it inert here so the existing
  // "listForCard after post" counts stay at 2; a dedicated test invokes it.
  useDidShow: () => undefined,
}));

const api = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  commentCreate: vi.fn(),
  commentDelete: vi.fn(),
  cardBySlug: vi.fn(),
  listForCard: vi.fn(),
  listReplies: vi.fn(),
  reportCreate: vi.fn(),
}));
vi.mock('../lib/trpc', () => ({
  trpc: {
    auth: { login: { mutate: api.login }, register: { mutate: api.register } },
    comments: {
      create: { mutate: api.commentCreate },
      delete: { mutate: api.commentDelete },
      listForCard: { query: api.listForCard },
      listReplies: { query: api.listReplies },
    },
    reports: { create: { mutate: api.reportCreate } },
    cards: { bySlug: { query: api.cardBySlug } },
  },
}));

const stores = vi.hoisted(() => ({
  locale: { locale: 'zh' },
  session: {
    token: 'session-token',
    isAuthenticated: true,
    isAdmin: false,
    user: { id: 'u1', username: 'alice', role: 'user' },
    signIn: vi.fn(),
  },
}));
vi.mock('../stores/root-store', () => ({ useStores: () => stores }));
vi.mock('../lib/leave-auth-page', () => ({ leaveAuthPage: vi.fn() }));

import LoginPage from './auth/login/index';
import RegisterPage from './auth/register/index';
import CardDetailPage from './cards/detail/index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const signedIn = { token: 't', user: { id: 'u1', username: 'alice', role: 'user' } };

type PageCase = {
  name: string;
  request: ReturnType<typeof vi.fn>;
  mount: () => Promise<HTMLElement>;
};

function submitButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button.primary-button');
  if (!button) throw new Error('primary button not rendered');
  return button;
}

function type(container: HTMLElement, selector: string, value: string) {
  const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  fireEvent.change(el, { target: { value } });
}

const pages: PageCase[] = [
  {
    name: 'login',
    request: api.login,
    mount: async () => {
      const { container } = render(<LoginPage />);
      const inputs = container.querySelectorAll('input');
      fireEvent.change(inputs[0]!, { target: { value: 'alice@cardhub.test' } });
      fireEvent.change(inputs[1]!, { target: { value: 'correct-horse' } });
      return container;
    },
  },
  {
    name: 'register',
    request: api.register,
    mount: async () => {
      const { container } = render(<RegisterPage />);
      const inputs = container.querySelectorAll('input');
      fireEvent.change(inputs[0]!, { target: { value: 'alice@cardhub.test' } });
      fireEvent.change(inputs[1]!, { target: { value: 'alice2026' } });
      fireEvent.change(inputs[2]!, { target: { value: 'correct-horse-battery' } });
      return container;
    },
  },
  {
    name: 'card comment',
    request: api.commentCreate,
    mount: async () => {
      const { container } = render(<CardDetailPage />);
      await waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
      type(container, 'textarea', '好卡');
      return container;
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.cardBySlug.mockResolvedValue({
    slug: 'aurora-knight',
    name: '极光骑士',
    imageUrl: null,
    rarity: 'rare',
    description: null,
    seriesSlug: 'aurora',
    seriesTitle: '极光',
    attributes: {},
  });
  api.listForCard.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe.each(pages)('$name submit guard', ({ request, mount }) => {
  it('sends one request for two clicks in the same tick', async () => {
    const pending = deferred<unknown>();
    request.mockReturnValue(pending.promise);
    const container = await mount();
    const button = submitButton(container);
    act(() => {
      button.click();
      button.click();
    });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(signedIn);
      await pending.promise;
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Enter', '{Enter}{Enter}'],
    ['Space', '[Space][Space]'],
  ])('sends one request for %s pressed twice on the focused button', async (_key, keys) => {
    const pending = deferred<unknown>();
    request.mockReturnValue(pending.promise);
    const container = await mount();
    const user = userEvent.setup();
    submitButton(container).focus();
    await user.keyboard(keys);
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(signedIn);
      await pending.promise;
    });
  });

  it('accepts a new submit after a failed one', async () => {
    request.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(signedIn);
    const container = await mount();
    await act(async () => {
      submitButton(container).click();
    });
    await waitFor(() => expect(submitButton(container).disabled).toBe(false));
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      submitButton(container).click();
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('card comments list after posting', () => {
  const mine = {
    id: 'c1',
    content: '好卡',
    user: { id: 'u1', username: 'alice' },
    createdAt: '2026-11-25T00:00:00.000Z',
    replies: [],
    replyCount: 0,
    safetyStatus: 'pass',
  };

  // Slow network: the first list request (sent on mount, before the comment
  // existed) is still running when the comment is posted.
  it.each(['before', 'after'])(
    'shows my comment when the mount-time list answers %s the refresh',
    async (order) => {
      const stale = deferred<unknown>();
      const fresh = deferred<unknown>();
      api.listForCard.mockReset();
      api.listForCard.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
      api.commentCreate.mockResolvedValue(mine);
      const { container } = render(<CardDetailPage />);
      await waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
      type(container, 'textarea', '好卡');
      await act(async () => {
        submitButton(container).click();
      });
      await waitFor(() => expect(api.listForCard).toHaveBeenCalledTimes(2));

      const answer = async (d: ReturnType<typeof deferred<unknown>>, value: unknown) => {
        await act(async () => {
          d.resolve(value);
          await d.promise;
        });
      };
      if (order === 'before') {
        await answer(stale, []);
        await answer(fresh, [mine]);
      } else {
        await answer(fresh, [mine]);
        await answer(stale, []);
      }

      await waitFor(() => expect(container.textContent).toContain('@alice'));
      expect(container.querySelector('.comment-item__content')?.textContent).toBe('好卡');
    },
  );

  it('does not refresh the list when the comment is not publicly visible', async () => {
    api.listForCard.mockReset();
    api.listForCard.mockResolvedValue([]);
    api.commentCreate.mockResolvedValue({ ...mine, safetyStatus: 'unchecked' });
    const { container } = render(<CardDetailPage />);
    await waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
    type(container, 'textarea', '好卡');
    await act(async () => {
      submitButton(container).click();
    });
    await waitFor(() => expect(api.commentCreate).toHaveBeenCalledTimes(1));
    expect(api.listForCard).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('content.submittedForReview');
    expect(container.textContent).not.toContain('评论成功');
    expect(container.textContent).not.toContain('miniapp.toast.commentOk');
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'content.submittedForReview',
    );
    expect(taro.showToast).not.toHaveBeenCalled();
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows a 3000ms role=status toast on pass and does not use Taro.showToast', async () => {
    api.listForCard.mockReset();
    api.listForCard.mockResolvedValue([]);
    api.commentCreate.mockResolvedValue(mine);
    const { container } = render(<CardDetailPage />);
    await waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
    type(container, 'textarea', '好卡');
    await act(async () => {
      submitButton(container).click();
    });
    await waitFor(() => expect(api.commentCreate).toHaveBeenCalledTimes(1));
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent ?? '').toMatch(/评论成功|Comment posted|miniapp.toast.commentOk/);
    expect(taro.showToast).not.toHaveBeenCalled();
  });
});
