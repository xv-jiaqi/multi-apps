// @vitest-environment jsdom
/**
 * Card-comment delete confirmation, listReplies load-more guard, report
 * submit-once, surface, and the useDidShow refresh after returning from login.
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/components', () => import('../test-stubs/taro-dom'));

const lifecycle = vi.hoisted(() => ({ didShow: null as null | (() => void) }));

const taro = vi.hoisted(() => ({
  showToast: vi.fn(async () => undefined),
  showActionSheet: vi.fn(async () => ({ tapIndex: 0 })),
  getEnv: vi.fn(() => 'WEB'),
  setNavigationBarTitle: vi.fn(async () => undefined),
  navigateTo: vi.fn(async () => undefined),
  redirectTo: vi.fn(async () => undefined),
  switchTab: vi.fn(async () => undefined),
  navigateBack: vi.fn(async () => undefined),
  pxTransform: (size: number) => `${size}px`,
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
}));
vi.mock('@tarojs/taro', () => ({
  default: taro,
  ...taro,
  useRouter: () => ({ params: { slug: 'aurora-knight' } }),
  useDidShow: (cb: () => void) => {
    lifecycle.didShow = cb;
  },
}));

const api = vi.hoisted(() => ({
  commentCreate: vi.fn(),
  commentDelete: vi.fn(),
  cardBySlug: vi.fn(),
  listForCard: vi.fn(),
  listReplies: vi.fn(),
  reportCreate: vi.fn(),
}));
vi.mock('../lib/trpc', () => ({
  trpc: {
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
  locale: { locale: 'zh-CN' as 'zh-CN' | 'en-US' },
  session: {
    token: 'session-token',
    isAuthenticated: true,
    isAdmin: false,
    user: { id: 'u1', username: 'alice', role: 'user' } as {
      id: string;
      username: string;
      role: string;
    } | null,
    signIn: vi.fn(),
  },
}));
vi.mock('../stores/root-store', () => ({ useStores: () => stores }));

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

const card = {
  slug: 'aurora-knight',
  name: '极光骑士',
  imageUrl: null,
  rarity: 'rare',
  description: null,
  seriesSlug: 'aurora',
  seriesTitle: '极光',
  attributes: {},
};

const other = {
  id: '00000000-0000-4000-8000-0000000000a1',
  content: '别人的评论',
  user: { id: 'u2', username: 'bob' },
  createdAt: '2026-11-25T00:00:00.000Z',
  replies: [
    {
      id: '00000000-0000-4000-8000-0000000000b1',
      content: '预览回复一',
      createdAt: '2026-11-25T00:01:00.000Z',
      user: { id: 'u3', username: 'cara' },
    },
    {
      id: '00000000-0000-4000-8000-0000000000b2',
      content: '预览回复二',
      createdAt: '2026-11-25T00:02:00.000Z',
      user: { id: 'u3', username: 'cara' },
    },
    {
      id: '00000000-0000-4000-8000-0000000000b3',
      content: '预览回复三',
      createdAt: '2026-11-25T00:03:00.000Z',
      user: { id: 'u3', username: 'cara' },
    },
  ],
  replyCount: 5,
  repliesNextCursor: '00000000-0000-4000-8000-0000000000b3',
  safetyStatus: 'pass',
};

const mine = {
  id: '00000000-0000-4000-8000-0000000000a2',
  content: '我的评论',
  user: { id: 'u1', username: 'alice' },
  createdAt: '2026-11-25T00:04:00.000Z',
  replies: [],
  replyCount: 0,
  repliesNextCursor: null,
  safetyStatus: 'review',
};

const extraReplies = [
  {
    id: '00000000-0000-4000-8000-0000000000b4',
    content: '第四条回复',
    createdAt: '2026-11-25T00:05:00.000Z',
    user: { id: 'u4', username: 'drew' },
    safetyStatus: 'pass',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b5',
    content: '第五条回复',
    createdAt: '2026-11-25T00:06:00.000Z',
    user: { id: 'u4', username: 'drew' },
    safetyStatus: 'pass',
  },
];

async function mountList(comments: unknown[] = [other, mine]) {
  api.listForCard.mockResolvedValue(comments);
  const view = render(<CardDetailPage />);
  await waitFor(() => expect(view.container.textContent).toContain('别人的评论'));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  lifecycle.didShow = null;
  stores.locale.locale = 'zh-CN';
  stores.session.token = 'session-token';
  stores.session.isAuthenticated = true;
  stores.session.isAdmin = false;
  stores.session.user = { id: 'u1', username: 'alice', role: 'user' };
  api.cardBySlug.mockResolvedValue(card);
  api.listForCard.mockResolvedValue([other, mine]);
  api.listReplies.mockResolvedValue({ items: extraReplies, nextCursor: null });
  api.commentDelete.mockResolvedValue({ ok: true });
  api.reportCreate.mockResolvedValue({ ok: true });
  taro.getEnv.mockReturnValue('WEB');
  taro.showActionSheet.mockImplementation(
    async (opts?: { success?: (r: { tapIndex: number }) => void }) => {
      opts?.success?.({ tapIndex: 0 });
      return { tapIndex: 0 };
    },
  );
});

afterEach(() => {
  cleanup();
});

function trpcErr(data: Record<string, unknown>) {
  const error = new Error('request failed');
  Object.defineProperty(error, 'data', { value: data, enumerable: true });
  return error;
}

async function refreshComments() {
  await act(async () => {
    lifecycle.didShow?.();
    lifecycle.didShow?.();
  });
}

describe('listForCard / listReplies surface', () => {
  it('sends surface miniapp on the card comment list and on load more', async () => {
    const { container } = await mountList();
    expect(api.listForCard).toHaveBeenCalledWith(
      expect.objectContaining({ cardSlug: 'aurora-knight', surface: 'miniapp' }),
    );
    const more = container.querySelector('.card-comment__more');
    expect(more).not.toBeNull();
    await act(async () => {
      more!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(api.listReplies).toHaveBeenCalledTimes(1));
    expect(api.listReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: '00000000-0000-4000-8000-0000000000a1',
        cursor: '00000000-0000-4000-8000-0000000000b3',
        limit: 20,
        surface: 'miniapp',
      }),
    );
  });
});

describe('listReplies load more', () => {
  it('sends one request when the button is clicked five times in the same tick', async () => {
    const pending = deferred<{ items: typeof extraReplies; nextCursor: string | null }>();
    api.listReplies.mockReturnValue(pending.promise);
    const { container } = await mountList();
    const more = container.querySelector('.card-comment__more') as HTMLButtonElement;
    expect(more.getAttribute('aria-disabled')).not.toBe('true');
    act(() => {
      for (let i = 0; i < 5; i += 1) more.click();
    });
    expect(api.listReplies).toHaveBeenCalledTimes(1);
    expect(more.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      pending.resolve({ items: extraReplies, nextCursor: null });
      await pending.promise;
    });
    await waitFor(() => expect(container.textContent).toContain('第四条回复'));
    expect(container.textContent).toContain('第五条回复');
    expect(container.querySelector('.card-comment__more')).toBeNull();
  });
});

describe('delete confirmation', () => {
  it('asks first, then sends one delete for two confirms in the same tick', async () => {
    const pending = deferred<unknown>();
    api.commentDelete.mockReturnValue(pending.promise);
    const { container } = await mountList();
    const deleteButtons = Array.from(container.querySelectorAll('.card-comment__action')).filter(
      (el) => el.textContent === '删除',
    );
    // Own comment only (alice); bob's comment has no delete.
    expect(deleteButtons.length).toBe(1);
    act(() => {
      (deleteButtons[0] as HTMLElement).click();
    });
    await waitFor(() => expect(container.textContent).toContain('删除这条评论？'));
    const confirm = Array.from(
      container.querySelectorAll('.card-comment__confirm .card-comment__action'),
    ).find((el) => el.textContent === '删除') as HTMLElement;
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(api.commentDelete).toHaveBeenCalledTimes(1);
    expect(api.commentDelete).toHaveBeenCalledWith({ id: '00000000-0000-4000-8000-0000000000a2' });
    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
    await waitFor(() => expect(container.textContent).toContain('评论已删除'));
    expect(container.textContent).not.toContain('我的评论');
    expect(api.listForCard.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(api.listForCard).toHaveBeenLastCalledWith(
      expect.objectContaining({ surface: 'miniapp' }),
    );
  });

  it('keeps the remaining comments and shows a status toast when delete succeeds but the refresh fails', async () => {
    const { container } = await mountList();
    const refresh = deferred<unknown>();
    api.listForCard.mockReset();
    api.listForCard.mockReturnValue(refresh.promise);

    const deleteButtons = Array.from(container.querySelectorAll('.card-comment__action')).filter(
      (el) => el.textContent === '删除',
    );
    act(() => {
      (deleteButtons[0] as HTMLElement).click();
    });
    await waitFor(() => expect(container.textContent).toContain('删除这条评论？'));
    const confirm = Array.from(
      container.querySelectorAll('.card-comment__confirm .card-comment__action'),
    ).find((el) => el.textContent === '删除') as HTMLElement;
    await act(async () => {
      confirm.click();
    });
    await waitFor(() => expect(api.commentDelete).toHaveBeenCalledTimes(1));

    await act(async () => {
      refresh.reject(new Error('refresh failed'));
      await refresh.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(container.textContent).toContain('别人的评论');
      expect(container.textContent).not.toContain('我的评论');
      expect(container.textContent).not.toContain('评论加载失败');
      expect(container.querySelector('.error-box-mini')).toBeNull();
      const toast = Array.from(container.querySelectorAll('[role="status"]')).find((el) =>
        (el.textContent || '').includes('已删除，列表暂未更新'),
      );
      expect(toast).toBeTruthy();
      expect(container.textContent).not.toContain('评论已删除');
    });
  });

  it("lets an admin delete someone else's comment after confirming", async () => {
    stores.session.isAdmin = true;
    const { container } = await mountList([other]);
    const deleteButtons = Array.from(container.querySelectorAll('.card-comment__action')).filter(
      (el) => el.textContent === '删除',
    );
    expect(deleteButtons.length).toBeGreaterThan(0);
    act(() => {
      (deleteButtons[0] as HTMLElement).click();
    });
    await waitFor(() => expect(container.textContent).toMatch(/删除这条评论/));
    const confirm = Array.from(
      container.querySelectorAll('.card-comment__confirm .card-comment__action'),
    ).find((el) => el.textContent === '删除') as HTMLElement;
    await act(async () => {
      confirm.click();
    });
    await waitFor(() =>
      expect(api.commentDelete).toHaveBeenCalledWith({
        id: '00000000-0000-4000-8000-0000000000a1',
      }),
    );
  });
});

describe('report entry', () => {
  it("hides the entry on the author's own comment and shows it on others", async () => {
    const { container } = await mountList();
    const triggers = Array.from(container.querySelectorAll('.report-entry__trigger'));
    // Other's comment + three preview replies; the viewer's own comment has no entry.
    expect(triggers.length).toBe(4);
    expect(triggers[0]!.textContent).toBe('举报');
  });

  it('opens the in-page form with a radiogroup on H5 and sends one report for two submits', async () => {
    const pending = deferred<unknown>();
    api.reportCreate.mockReturnValue(pending.promise);
    const { container } = await mountList();
    act(() => {
      (container.querySelector('.report-entry__trigger') as HTMLElement).click();
    });
    expect(taro.showActionSheet).not.toHaveBeenCalled();
    await waitFor(() => expect(container.querySelector('.report-entry__form')).not.toBeNull());
    const group = container.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();
    const radios = container.querySelectorAll('.report-entry__reason-option');
    expect(radios.length).toBe(5);
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
    expect(radios[0]!.textContent).toBe('垃圾广告');
    const submit = container.querySelector(
      '.report-entry__form button.primary-button',
    ) as HTMLButtonElement;
    act(() => {
      submit.click();
      submit.click();
    });
    expect(api.reportCreate).toHaveBeenCalledTimes(1);
    const body = api.reportCreate.mock.calls[0]![0] as {
      targetType: string;
      targetId: string;
      reason: string;
    };
    expect(body).toMatchObject({
      targetType: 'COMMENT',
      targetId: '00000000-0000-4000-8000-0000000000a1',
    });
    expect(body.reason.length).toBeGreaterThanOrEqual(4);
    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
    await waitFor(() => expect(container.textContent).toContain('举报已提交'));
    expect(container.querySelector('.report-entry__form')).toBeNull();
  });

  it('sends an unauthenticated viewer to login instead of opening the sheet', async () => {
    stores.session.isAuthenticated = false;
    stores.session.token = '';
    stores.session.user = null;
    const { container } = await mountList([other]);
    act(() => {
      (container.querySelector('.report-entry__trigger') as HTMLElement).click();
    });
    expect(taro.showActionSheet).not.toHaveBeenCalled();
    expect(taro.navigateTo).toHaveBeenCalled();
  });

  it('shows report.submitFailed when create returns 400, 413 or 500', async () => {
    const { container } = await mountList();
    for (const data of [
      { code: 'BAD_REQUEST', httpStatus: 400 },
      { code: 'PAYLOAD_TOO_LARGE', httpStatus: 413 },
      { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
    ]) {
      api.reportCreate.mockRejectedValueOnce(trpcErr(data));
      act(() => {
        (container.querySelector('.report-entry__trigger') as HTMLElement).click();
      });
      await waitFor(() => expect(container.querySelector('.report-entry__form')).not.toBeNull());
      const submit = container.querySelector(
        '.report-entry__form button.primary-button',
      ) as HTMLButtonElement;
      await act(async () => {
        submit.click();
      });
      await waitFor(() => expect(container.textContent).toContain('提交失败，请重试'));
      const cancel = container.querySelector('.report-entry__cancel') as HTMLElement;
      act(() => {
        cancel.click();
      });
    }
  });

  it('counts the preset reason toward the 500-character limit', async () => {
    const { container } = await mountList();
    act(() => {
      (container.querySelector('.report-entry__trigger') as HTMLElement).click();
    });
    await waitFor(() => expect(container.querySelector('.report-entry__form')).not.toBeNull());
    const count = container.querySelector('.report-entry__count') as HTMLElement;
    // 垃圾广告 = 4
    expect(count.textContent?.replace(/\s/g, '')).toBe('4/500');
    const textarea = container.querySelector('.report-entry__textarea') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '补充' } });
    });
    // 垃圾广告 + newline + 补充 = 7
    expect(container.querySelector('.report-entry__count')?.textContent?.replace(/\s/g, '')).toBe(
      '7/500',
    );
  });

  it('associates the details label with the textarea via aria-labelledby', async () => {
    const { container } = await mountList();
    act(() => {
      (container.querySelector('.report-entry__trigger') as HTMLElement).click();
    });
    await waitFor(() => expect(container.querySelector('.report-entry__form')).not.toBeNull());
    const textarea = container.querySelector('.report-entry__textarea') as HTMLTextAreaElement;
    const labelledBy = textarea.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const label = container.querySelector(`#${labelledBy}`);
    expect(label?.textContent).toBe('补充说明');
  });

  it('moves focus into the form, and back to Report after Escape or cancel', async () => {
    const { container } = await mountList();
    const trigger = container.querySelector('.report-entry__trigger') as HTMLButtonElement;
    act(() => {
      trigger.focus();
      trigger.click();
    });
    await waitFor(() => expect(container.querySelector('.report-entry__form')).not.toBeNull());
    expect(container.querySelector('.report-entry__form')?.contains(document.activeElement)).toBe(
      true,
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await waitFor(() => expect(container.querySelector('.report-entry__form')).toBeNull());
    expect(document.activeElement).toBe(container.querySelector('.report-entry__trigger'));

    act(() => {
      (container.querySelector('.report-entry__trigger') as HTMLElement).click();
    });
    await waitFor(() => expect(container.querySelector('.report-entry__form')).not.toBeNull());
    act(() => {
      (container.querySelector('.report-entry__cancel') as HTMLElement).click();
    });
    await waitFor(() => expect(container.querySelector('.report-entry__form')).toBeNull());
    expect(document.activeElement).toBe(container.querySelector('.report-entry__trigger'));
  });

  it('uses ActionSheet on the native surface, then a read-only reason', async () => {
    taro.getEnv.mockReturnValue('WEAPP');
    const { container } = await mountList();
    act(() => {
      (container.querySelector('.report-entry__trigger') as HTMLElement).click();
    });
    expect(taro.showActionSheet).toHaveBeenCalledTimes(1);
    const firstSheet = taro.showActionSheet.mock.calls[0] as unknown as
      | [{ itemList: string[] }]
      | undefined;
    expect(firstSheet?.[0].itemList).toHaveLength(5);
    await waitFor(() => expect(container.querySelector('.report-entry__form')).not.toBeNull());
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.querySelector('.report-entry__reason-text')?.textContent).toBe('垃圾广告');
    taro.getEnv.mockReturnValue('WEB');
  });
});

describe('useDidShow comment refresh', () => {
  it('reloads comments with fresh after the first onShow when returning from login', async () => {
    await mountList();
    const afterMount = api.listForCard.mock.calls.length;
    expect(lifecycle.didShow).not.toBeNull();
    // First invocation is the mount-time onShow, which the page skips.
    act(() => {
      lifecycle.didShow?.();
    });
    expect(api.listForCard).toHaveBeenCalledTimes(afterMount);
    act(() => {
      lifecycle.didShow?.();
    });
    await waitFor(() => expect(api.listForCard).toHaveBeenCalledTimes(afterMount + 1));
  });
});

describe('listReplies reset after comment refresh', () => {
  it('drops stale loaded replies when a refresh shifts the preview (no duplicate, correct remaining)', async () => {
    const { container } = await mountList([other]);
    const more = container.querySelector('.card-comment__more') as HTMLButtonElement;
    await act(async () => {
      more.click();
    });
    await waitFor(() => expect(container.textContent).toContain('第四条回复'));
    expect(container.textContent).toContain('第五条回复');

    const shifted = {
      ...other,
      replies: [
        other.replies[1]!,
        other.replies[2]!,
        {
          id: extraReplies[0]!.id,
          content: extraReplies[0]!.content,
          createdAt: extraReplies[0]!.createdAt,
          user: extraReplies[0]!.user,
        },
      ],
      replyCount: 4,
      repliesNextCursor: extraReplies[0]!.id,
    };
    api.listForCard.mockResolvedValue([shifted]);
    await refreshComments();
    await waitFor(() => {
      const text = container.textContent ?? '';
      expect(text.split('第四条回复').length - 1).toBe(1);
      expect(text).not.toContain('第五条回复');
      expect(text).toContain('展开其余 1 条回复');
    });
  });

  it('shows load-more when a refresh newly returns a replies cursor', async () => {
    const three = { ...other, replyCount: 3, repliesNextCursor: null };
    const { container } = await mountList([three]);
    expect(container.querySelector('.card-comment__more')).toBeNull();

    api.listForCard.mockResolvedValue([
      {
        ...three,
        replyCount: 6,
        repliesNextCursor: three.replies[2]!.id,
      },
    ]);
    await refreshComments();
    await waitFor(() => {
      expect(container.textContent).toContain('展开其余 3 条回复');
    });
  });
});

describe('preview reply pending-review tag', () => {
  it('shows the under-review tag when a preview reply has safetyStatus review', async () => {
    const preview = {
      ...other,
      replies: [
        { ...other.replies[0], user: { id: 'u1', username: 'alice' }, safetyStatus: 'review' },
        other.replies[1]!,
        other.replies[2]!,
      ],
    };
    const { container } = await mountList([preview]);
    expect(container.textContent).toContain('审核中');
  });
});

describe('delete 404 and 401', () => {
  it('hides the comment when delete returns NOT_FOUND', async () => {
    api.commentDelete.mockRejectedValue(trpcErr({ code: 'NOT_FOUND' }));
    const { container } = await mountList();
    const deleteButtons = Array.from(container.querySelectorAll('.card-comment__action')).filter(
      (el) => (el.textContent || '').includes('删除'),
    );
    act(() => {
      (deleteButtons[0] as HTMLElement).click();
    });
    await waitFor(() => expect(container.textContent).toContain('删除这条评论？'));
    const confirm = Array.from(
      container.querySelectorAll('.card-comment__confirm .card-comment__action'),
    ).find((el) => (el.textContent || '').includes('删除')) as HTMLElement;
    await act(async () => {
      confirm.click();
    });
    await waitFor(() => expect(container.textContent).not.toContain('我的评论'));
    expect(container.textContent).not.toContain('删除失败');
    expect(container.querySelector('.notice-banner--error')).toBeNull();
  });

  it('goes to login when delete returns UNAUTHORIZED', async () => {
    api.commentDelete.mockRejectedValue(trpcErr({ code: 'UNAUTHORIZED' }));
    const { container } = await mountList();
    const deleteButtons = Array.from(container.querySelectorAll('.card-comment__action')).filter(
      (el) => (el.textContent || '').includes('删除'),
    );
    act(() => {
      (deleteButtons[0] as HTMLElement).click();
    });
    await waitFor(() => expect(container.textContent).toContain('删除这条评论？'));
    const confirm = Array.from(
      container.querySelectorAll('.card-comment__confirm .card-comment__action'),
    ).find((el) => (el.textContent || '').includes('删除')) as HTMLElement;
    await act(async () => {
      confirm.click();
    });
    await waitFor(() =>
      expect(taro.navigateTo).toHaveBeenCalledWith({ url: '/pages/auth/login/index' }),
    );
  });
});

describe('delete failure', () => {
  async function confirmDelete(container: HTMLElement) {
    const deleteBtn = Array.from(container.querySelectorAll('.card-comment__action')).find((el) =>
      (el.textContent || '').includes('删除'),
    ) as HTMLElement;
    act(() => {
      deleteBtn.click();
    });
    await waitFor(() => expect(container.textContent).toContain('删除这条评论？'));
    const confirm = Array.from(
      container.querySelectorAll('.card-comment__confirm .card-comment__action'),
    ).find((el) => (el.textContent || '').includes('删除')) as HTMLElement;
    await act(async () => {
      confirm.click();
    });
    return deleteBtn;
  }

  it('closes the confirm bar, focuses Delete, and shows a red box on the comment', async () => {
    api.commentDelete.mockRejectedValue(
      trpcErr({ code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 }),
    );
    const { container } = await mountList();
    const deleteBtn = await confirmDelete(container);
    await waitFor(() => expect(container.querySelector('.card-comment__error')).not.toBeNull());
    expect(container.querySelector('.card-comment__confirm')).toBeNull();
    expect(container.querySelector('.card-comment__error')?.textContent).toBe('删除失败，请重试');
    expect(container.querySelector('.notice-banner--error')).toBeNull();
    expect(document.activeElement).toBe(deleteBtn);
  });

  it('uses commentDeleteForbidden for FORBIDDEN', async () => {
    api.commentDelete.mockRejectedValue(trpcErr({ code: 'FORBIDDEN' }));
    const { container } = await mountList();
    await confirmDelete(container);
    await waitFor(() =>
      expect(container.querySelector('.card-comment__error')?.textContent).toBe(
        '你没有权限删除这条评论',
      ),
    );
    expect(container.querySelector('.card-comment__confirm')).toBeNull();
  });
});

describe('action buttons', () => {
  it('exposes delete, report, confirm and cancel as buttons with accessible names', async () => {
    const { container } = await mountList();
    const report = container.querySelector('.report-entry__trigger') as HTMLElement;
    expect(report.getAttribute('role') === 'button' || report.tagName === 'BUTTON').toBe(true);
    expect(report.getAttribute('aria-label') || report.textContent || '').toContain('举报');

    const deleteBtn = Array.from(container.querySelectorAll('.card-comment__action')).find((el) =>
      (el.textContent || '').includes('删除'),
    ) as HTMLElement;
    expect(deleteBtn.getAttribute('role') === 'button' || deleteBtn.tagName === 'BUTTON').toBe(
      true,
    );
    expect(
      (deleteBtn.getAttribute('aria-label') || deleteBtn.textContent || '').length,
    ).toBeGreaterThan(0);

    act(() => {
      deleteBtn.click();
    });
    await waitFor(() => expect(container.textContent).toContain('删除这条评论？'));
    const confirmButtons = Array.from(
      container.querySelectorAll('.card-comment__confirm .card-comment__action'),
    );
    expect(confirmButtons.length).toBe(2);
    for (const el of confirmButtons) {
      expect(el.getAttribute('role') === 'button' || el.tagName === 'BUTTON').toBe(true);
      expect((el as HTMLElement).tabIndex).toBe(0);
    }
    expect(report.tabIndex).toBe(0);
    expect(deleteBtn.tabIndex).toBe(0);
    expect(
      container.querySelector('.card-comment__confirm')?.contains(document.activeElement),
    ).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await waitFor(() => expect(container.querySelector('.card-comment__confirm')).toBeNull());
    expect(document.activeElement).toBe(deleteBtn);
  });

  it('opens the confirm bar with Enter and Space on Delete', async () => {
    const { container } = await mountList();
    const deleteBtn = Array.from(container.querySelectorAll('.card-comment__action')).find((el) =>
      (el.textContent || '').includes('删除'),
    ) as HTMLElement;
    act(() => {
      fireEvent.keyDown(deleteBtn, { key: 'Enter' });
    });
    await waitFor(() => expect(container.textContent).toContain('删除这条评论？'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await waitFor(() => expect(container.querySelector('.card-comment__confirm')).toBeNull());
    act(() => {
      fireEvent.keyDown(deleteBtn, { key: ' ' });
    });
    await waitFor(() => expect(container.textContent).toContain('删除这条评论？'));
  });
});
