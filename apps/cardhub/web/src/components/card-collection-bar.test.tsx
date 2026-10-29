import { useSyncExternalStore } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { APP_ERROR_CODES } from '@repo/shared';
import { rootStore } from '../stores/root-store';

const bus = vi.hoisted(() => {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    version: () => version,
    emit() {
      version += 1;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

const queryState = {
  data: null as { ownedCount: number; wanted: boolean } | null,
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  error: null as unknown,
  errorUpdateCount: 0,
  dataUpdatedAt: 1,
  refetch: vi.fn(),
};

const enabledFlags: boolean[] = [];
const calls: Array<{
  input: { cardSlug: string; ownedCount: number; wanted: boolean };
  opts: {
    onSuccess?: (result: unknown) => void;
    onError?: (error: unknown) => void;
  };
}> = [];

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    useUtils: () => ({ collection: { byCard: { setData: vi.fn() } } }),
    collection: {
      byCard: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
          enabledFlags.push(Boolean(opts?.enabled));
          return useCollectionQuery();
        },
      },
      upsert: {
        useMutation: () => ({
          mutate: (
            input: { cardSlug: string; ownedCount: number; wanted: boolean },
            opts: {
              onSuccess?: (result: unknown) => void;
              onError?: (error: unknown) => void;
            } = {},
          ) => {
            calls.push({ input, opts });
          },
          isPending: false,
        }),
      },
    },
  },
}));

import { CardCollectionBar, collectionWriteFailure } from './card-collection-bar';
import { SessionExpiryWatcher } from './session-expiry-watcher';
import { noteTrpcFailure } from '../lib/session-expiry';

function useCollectionQuery() {
  useSyncExternalStore(bus.subscribe, bus.version, bus.version);
  return queryState;
}

function trpcError(data: Record<string, unknown>) {
  return { data };
}

function zodOwned(message: string) {
  return trpcError({
    code: 'BAD_REQUEST',
    appCode: APP_ERROR_CODES.VALIDATION,
    path: 'collection.upsert',
    zodError: {
      fieldErrors: { ownedCount: [message] },
      issues: [{ path: ['ownedCount'], message }],
    },
  });
}

const notFound = trpcError({
  code: 'NOT_FOUND',
  appCode: APP_ERROR_CODES.NOT_FOUND,
  path: 'collection.upsert',
});

const tooMany = trpcError({
  code: 'TOO_MANY_REQUESTS',
  appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
  path: 'collection.upsert',
});

const unauthorized = trpcError({
  code: 'UNAUTHORIZED',
  appCode: APP_ERROR_CODES.UNAUTHORIZED,
  path: 'collection.upsert',
});

function LoginProbe() {
  const location = useLocation();
  return <p>{`${location.pathname}${location.search}|${JSON.stringify(location.state)}`}</p>;
}

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/cards/aurora-knight']}>
      <SessionExpiryWatcher />
      <Routes>
        <Route
          path="/cards/:cardSlug"
          element={<CardCollectionBar cardSlug="aurora-knight" cardName="极光骑士" />}
        />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderBarBesideLogin() {
  return render(
    <MemoryRouter initialEntries={['/cards/aurora-knight']}>
      <SessionExpiryWatcher />
      <CardCollectionBar cardSlug="aurora-knight" cardName="极光骑士" />
      <Routes>
        <Route path="/cards/:cardSlug" element={null} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function signIn() {
  rootStore.session.signIn('token', { id: 'u1', username: 'alice' });
}

function resetQuery() {
  queryState.data = null;
  queryState.isLoading = false;
  queryState.isPending = false;
  queryState.isFetching = false;
  queryState.isError = false;
  queryState.error = null;
  queryState.errorUpdateCount = 0;
  queryState.dataUpdatedAt = 1;
  queryState.refetch = vi.fn();
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  enabledFlags.length = 0;
  calls.length = 0;
  resetQuery();
});

describe('collection write failure copy', () => {
  it('maps ownedCount codes to the quantity sentence and keeps other paths generic', () => {
    for (const code of ['collection_quantity', 'too_small', 'too_big', 'invalid_type']) {
      const failure = collectionWriteFailure('zh-CN', zodOwned(code));
      expect(failure).toEqual({ kind: 'field', text: '数量只能是 0 到 99 的整数' });
    }
    expect(collectionWriteFailure('en-US', zodOwned('too_big'))).toEqual({
      kind: 'field',
      text: 'Enter a whole number from 0 to 99.',
    });
    const otherField = trpcError({
      code: 'BAD_REQUEST',
      appCode: APP_ERROR_CODES.VALIDATION,
      zodError: {
        fieldErrors: { cardSlug: ['too_big'] },
        issues: [{ path: ['cardSlug'], message: 'too_big' }],
      },
    });
    expect(collectionWriteFailure('zh-CN', otherField)).toEqual({
      kind: 'alert',
      text: '填写的内容不符合要求，请修改后再试',
    });
    expect(collectionWriteFailure('zh-CN', notFound)).toEqual({
      kind: 'alert',
      text: '内容不存在或已被删除',
    });
    expect(collectionWriteFailure('zh-CN', tooMany)).toEqual({
      kind: 'alert',
      text: '操作太频繁，请稍后再试',
    });
    expect(collectionWriteFailure('en-US', tooMany)).toEqual({
      kind: 'alert',
      text: 'Too many actions. Try again later.',
    });
    expect(collectionWriteFailure('zh-CN', unauthorized)).toEqual({ kind: 'redirect' });
    expect(collectionWriteFailure('en-US', unauthorized)).toEqual({ kind: 'redirect' });
    const genericMessage = '填写的内容不符合要求，请修改后再试';
    const ranged = {
      message: genericMessage,
      data: {
        code: 'BAD_REQUEST',
        appCode: APP_ERROR_CODES.VALIDATION,
        zodError: {
          fieldErrors: { ownedCount: ['collection_quantity'] },
          issues: [{ path: ['ownedCount'], message: genericMessage, code: 'too_big' }],
        },
      },
    };
    expect(collectionWriteFailure('zh-CN', ranged)).toEqual({
      kind: 'field',
      text: '数量只能是 0 到 99 的整数',
    });
    expect(collectionWriteFailure('en-US', ranged)).toEqual({
      kind: 'field',
      text: 'Enter a whole number from 0 to 99.',
    });
    expect(collectionWriteFailure('zh-CN', ranged)).not.toEqual({
      kind: 'alert',
      text: genericMessage,
    });
  });
});

describe('card collection bar', () => {
  it('shows an unpressed bar and does not read byCard while signed out', async () => {
    const user = userEvent.setup();
    renderBar();

    expect(enabledFlags.every((enabled) => enabled === false)).toBe(true);
    expect(screen.getByRole('heading', { level: 2, name: '我的收藏' })).toHaveClass('sr-only');
    const own = screen.getByRole('button', { name: '我有' });
    const want = screen.getByRole('button', { name: '想要' });
    expect(own).toHaveAttribute('aria-pressed', 'false');
    expect(want).toHaveAttribute('aria-pressed', 'false');
    expect(own).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: '数量' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '我的收藏' })).toHaveTextContent('登录后可记录收藏');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(own);
    expect(calls).toHaveLength(0);
    expect(screen.getByText('/login|{"from":"/cards/aurora-knight"}')).toBeInTheDocument();
  });

  it('uses the English signed-out hint and keeps tab order without the quantity field', async () => {
    const user = userEvent.setup();
    rootStore.locale.setLocale('en-US');
    renderBar();

    expect(screen.getByRole('region', { name: 'My collection' })).toHaveTextContent(
      'Sign in to track your collection.',
    );
    const own = screen.getByRole('button', { name: 'I have it' });
    own.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Want' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Sign in' }));
  });

  it('shows skeletons instead of an error while byCard is loading', () => {
    signIn();
    queryState.isLoading = true;
    queryState.isPending = true;
    queryState.isFetching = true;
    queryState.dataUpdatedAt = 0;
    renderBar();

    const own = screen.getByRole('button', { name: '我有' });
    const region = screen.getByRole('region', { name: '我的收藏' });
    expect(own).toBeEnabled();
    expect(own).toHaveAttribute('aria-disabled', 'true');
    expect(own).not.toHaveAttribute('disabled');
    expect(own).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '想要' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: '分享' })).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: '数量' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const skeletons = region.querySelectorAll('.animate-pulse');
    expect(skeletons).toHaveLength(2);
    expect(skeletons[0]).toHaveClass(
      'motion-reduce:animate-none',
      'bg-neutral-200',
      'rounded',
      'h-10',
    );
    expect(region.querySelector('.grid')).toHaveClass('grid-cols-2', 'gap-3', 'min-w-0', 'md:flex');
    expect(screen.getByRole('button', { name: '分享' })).toHaveClass('md:ms-auto', 'w-full');
  });

  it('prefers the byCard error over the loading skeleton and retries only that read', async () => {
    const user = userEvent.setup();
    signIn();
    queryState.isError = true;
    queryState.isLoading = true;
    queryState.isPending = true;
    queryState.isFetching = false;
    queryState.error = { message: 'secret-db-down', data: { code: 'INTERNAL_SERVER_ERROR' } };
    queryState.errorUpdateCount = 1;
    queryState.dataUpdatedAt = 0;
    renderBar();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('收藏状态加载失败');
    expect(alert).not.toHaveTextContent('secret-db-down');
    expect(
      screen.getByRole('region', { name: '我的收藏' }).querySelector('.animate-pulse'),
    ).toBeNull();
    expect(screen.getByRole('button', { name: '我有' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '分享' })).toBeEnabled();

    queryState.refetch = vi.fn(() => {
      queryState.isError = false;
      queryState.isLoading = false;
      queryState.isPending = false;
      queryState.isFetching = false;
      queryState.error = null;
      queryState.data = { ownedCount: 1, wanted: false };
      queryState.dataUpdatedAt = 2;
      bus.emit();
    });
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(queryState.refetch).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我有' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: '数量' })).toHaveValue('1');
  });

  it('keeps the error visible while the first retry is in flight', () => {
    signIn();
    queryState.isPending = true;
    queryState.isFetching = true;
    queryState.isLoading = false;
    queryState.isError = false;
    queryState.errorUpdateCount = 1;
    queryState.dataUpdatedAt = 0;
    renderBar();

    expect(screen.getByRole('alert')).toHaveTextContent('收藏状态加载失败');
    expect(screen.getByRole('button', { name: '重试中…' })).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.getByRole('region', { name: '我的收藏' }).querySelector('.animate-pulse'),
    ).toBeNull();
  });

  it('shows both toggles off when byCard is null, and the saved record when it is not', () => {
    signIn();
    const view = renderBar();
    expect(screen.getByRole('button', { name: '我有' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '想要' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('textbox', { name: '数量' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '系列进度' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '收藏的卡' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('region', { name: '我的收藏' })).not.toHaveTextContent(
      '登录后可记录收藏',
    );

    view.unmount();
    queryState.data = { ownedCount: 2, wanted: true };
    renderBar();
    const own = screen.getByRole('button', { name: '我有' });
    const want = screen.getByRole('button', { name: '想要' });
    expect(own).toHaveAttribute('aria-pressed', 'true');
    expect(want).toHaveAttribute('aria-pressed', 'true');
    expect(own.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(want.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('textbox', { name: '数量' })).toHaveValue('2');
  });

  it('ignores toggle clicks while loading and keeps focus on the same button', async () => {
    const user = userEvent.setup();
    signIn();
    queryState.isLoading = true;
    queryState.isPending = true;
    queryState.isFetching = true;
    queryState.dataUpdatedAt = 0;
    renderBar();

    const own = screen.getByRole('button', { name: '我有' });
    own.focus();
    await user.click(own);
    await user.keyboard('{Enter}');
    expect(calls).toHaveLength(0);
    expect(document.activeElement).toBe(own);

    queryState.isLoading = false;
    queryState.isPending = false;
    queryState.isFetching = false;
    queryState.data = { ownedCount: 2, wanted: false };
    queryState.dataUpdatedAt = 2;
    act(() => {
      bus.emit();
    });

    expect(own.isConnected).toBe(true);
    expect(document.activeElement).toBe(own);
    expect(own).toHaveAttribute('aria-pressed', 'true');
    expect(own).not.toHaveAttribute('aria-disabled');
  });

  it('keeps focus on 我有 when the quantity field appears, then walks the signed-in order', async () => {
    const user = userEvent.setup();
    signIn();
    renderBar();

    const own = screen.getByRole('button', { name: '我有' });
    await user.click(own);
    expect(own).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(own);
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: '数量' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '数量' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '想要' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '分享' }));
  });

  it('keeps the pressed toggle mounted after the check icon and a failed write', async () => {
    const user = userEvent.setup();
    signIn();
    renderBar();

    const own = screen.getByRole('button', { name: '我有' });
    await user.click(own);
    expect(document.activeElement).toBe(own);
    await act(async () => {
      calls[0]?.opts.onSuccess?.({
        outcome: 'saved',
        item: { ownedCount: 1, wanted: false },
      });
    });
    expect(own.isConnected).toBe(true);
    expect(document.activeElement).toBe(own);
    expect(screen.getByRole('button', { name: '我有' })).toBe(own);

    const want = screen.getByRole('button', { name: '想要' });
    await user.click(want);
    expect(document.activeElement).toBe(want);
    await act(async () => {
      calls[1]?.opts.onError?.(notFound);
    });
    expect(want.isConnected).toBe(true);
    expect(document.activeElement).toBe(want);
    expect(screen.getByRole('button', { name: '想要' })).toBe(want);
  });

  it('updates optimistically, reconciles a saved item, and rolls back a failed write', async () => {
    const user = userEvent.setup();
    signIn();
    renderBar();

    const own = screen.getByRole('button', { name: '我有' });
    await user.click(own);
    expect(own).toBeEnabled();
    expect(own).not.toHaveAttribute('aria-busy');
    expect(calls[0]?.input).toEqual({ cardSlug: 'aurora-knight', ownedCount: 1, wanted: false });
    await act(async () => {
      calls[0]?.opts.onSuccess?.({
        outcome: 'saved',
        item: { ownedCount: 3, wanted: true },
      });
    });
    expect(screen.getByRole('textbox', { name: '数量' })).toHaveValue('3');
    expect(screen.getByRole('button', { name: '想要' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '想要' }));
    expect(calls[1]?.input).toEqual({ cardSlug: 'aurora-knight', ownedCount: 3, wanted: false });
    await act(async () => {
      calls[1]?.opts.onError?.(notFound);
    });
    expect(screen.getByRole('button', { name: '想要' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('内容不存在或已被删除');
    expect(screen.getByRole('alert').querySelector('button')).toBeNull();
  });

  it('drops a queued write and returns to the last saved entry when a request fails', async () => {
    const user = userEvent.setup();
    signIn();
    renderBar();

    await user.click(screen.getByRole('button', { name: '我有' }));
    await user.click(screen.getByRole('button', { name: '想要' }));
    expect(calls).toHaveLength(1);
    expect(screen.getByRole('button', { name: '想要' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => {
      calls[0]?.opts.onError?.(tooMany);
    });
    expect(calls).toHaveLength(1);
    expect(screen.getByRole('button', { name: '我有' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '想要' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('alert')).toHaveTextContent('操作太频繁，请稍后再试');
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('clears both toggles when the server removes the row', async () => {
    const user = userEvent.setup();
    signIn();
    queryState.data = { ownedCount: 2, wanted: false };
    renderBar();

    await user.click(screen.getByRole('button', { name: '我有' }));
    expect(calls[0]?.input).toEqual({ cardSlug: 'aurora-knight', ownedCount: 0, wanted: false });
    await act(async () => {
      calls[0]?.opts.onSuccess?.({ outcome: 'removed', cardSlug: 'aurora-knight' });
    });
    expect(screen.getByRole('button', { name: '我有' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('textbox', { name: '数量' })).not.toBeInTheDocument();
  });

  it('rejects 100, -1, and a decimal locally without writing', async () => {
    const user = userEvent.setup();
    signIn();
    queryState.data = { ownedCount: 2, wanted: true };
    renderBar();

    const quantity = screen.getByRole('textbox', { name: '数量' });
    for (const value of ['100', '-1', '1.5']) {
      await user.clear(quantity);
      await user.type(quantity, value);
      await user.tab();
      expect(calls).toHaveLength(0);
      expect(quantity).toHaveValue(value);
      expect(quantity).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText('数量只能是 0 到 99 的整数')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  });

  it('uses the English quantity sentence for a local out-of-range value', async () => {
    const user = userEvent.setup();
    rootStore.locale.setLocale('en-US');
    signIn();
    queryState.data = { ownedCount: 2, wanted: false };
    renderBar();

    const quantity = screen.getByRole('textbox', { name: 'Quantity' });
    await user.clear(quantity);
    await user.type(quantity, '100');
    await user.tab();
    expect(calls).toHaveLength(0);
    expect(quantity).toHaveValue('100');
    expect(screen.getByText('Enter a whole number from 0 to 99.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['zh-CN', 'too_small', '数量只能是 0 到 99 的整数', '填写的内容不符合要求，请修改后再试'],
    ['zh-CN', 'too_big', '数量只能是 0 到 99 的整数', '填写的内容不符合要求，请修改后再试'],
    ['zh-CN', 'invalid_type', '数量只能是 0 到 99 的整数', '填写的内容不符合要求，请修改后再试'],
    [
      'zh-CN',
      'collection_quantity',
      '数量只能是 0 到 99 的整数',
      '填写的内容不符合要求，请修改后再试',
    ],
    [
      'en-US',
      'too_big',
      'Enter a whole number from 0 to 99.',
      'Some fields need to be changed before you can continue.',
    ],
    [
      'en-US',
      'collection_quantity',
      'Enter a whole number from 0 to 99.',
      'Some fields need to be changed before you can continue.',
    ],
  ] as const)(
    'shows the quantity sentence for %s ownedCount code %s, not the generic validation sentence',
    async (locale, code, sentence, generic) => {
      const user = userEvent.setup();
      rootStore.locale.setLocale(locale);
      signIn();
      queryState.data = { ownedCount: 2, wanted: false };
      renderBar();

      const quantityName = locale === 'zh-CN' ? '数量' : 'Quantity';
      const quantity = screen.getByRole('textbox', { name: quantityName });
      await user.clear(quantity);
      await user.type(quantity, '4');
      await user.tab();
      expect(calls[0]?.input.ownedCount).toBe(4);
      await act(async () => {
        calls[0]?.opts.onError?.({
          message: generic,
          data: {
            code: 'BAD_REQUEST',
            httpStatus: 400,
            appCode: APP_ERROR_CODES.VALIDATION,
            zodError: {
              fieldErrors: { ownedCount: [code] },
              issues: [{ path: ['ownedCount'], message: code }],
            },
          },
        });
      });
      expect(screen.getByRole('textbox', { name: quantityName })).toHaveValue('2');
      expect(screen.getByText(sentence)).toBeInTheDocument();
      expect(screen.queryByText(generic)).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('rejects an illegal quantity without writing, and submits 0 as clearing 我有', async () => {
    const user = userEvent.setup();
    signIn();
    queryState.data = { ownedCount: 2, wanted: true };
    renderBar();

    const quantity = screen.getByRole('textbox', { name: '数量' });
    await user.clear(quantity);
    await user.type(quantity, '100');
    await user.tab();
    expect(calls).toHaveLength(0);
    expect(quantity).toHaveValue('100');
    expect(quantity).toHaveAttribute('aria-invalid', 'true');
    expect(quantity).toHaveAttribute('aria-describedby');
    expect(screen.getByText('数量只能是 0 到 99 的整数')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我有' })).toHaveAttribute('aria-pressed', 'true');

    await user.clear(quantity);
    await user.type(quantity, 'x');
    quantity.focus();
    await user.keyboard('{Enter}');
    expect(calls).toHaveLength(0);
    expect(screen.getAllByText('数量只能是 0 到 99 的整数')).toHaveLength(1);

    await user.clear(quantity);
    await user.type(quantity, '0');
    await user.tab();
    expect(calls[0]?.input).toEqual({ cardSlug: 'aurora-knight', ownedCount: 0, wanted: true });
    expect(screen.getByRole('button', { name: '我有' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '想要' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a server quantity error on the field and rolls the number back', async () => {
    const user = userEvent.setup();
    signIn();
    queryState.data = { ownedCount: 2, wanted: false };
    renderBar();

    const quantity = screen.getByRole('textbox', { name: '数量' });
    await user.clear(quantity);
    await user.type(quantity, '4');
    await user.tab();
    expect(calls[0]?.input.ownedCount).toBe(4);
    const generic = '填写的内容不符合要求，请修改后再试';
    await act(async () => {
      calls[0]?.opts.onError?.({
        message: generic,
        data: {
          code: 'BAD_REQUEST',
          appCode: APP_ERROR_CODES.VALIDATION,
          zodError: {
            fieldErrors: { ownedCount: ['collection_quantity'] },
            issues: [{ path: ['ownedCount'], message: generic, code: 'too_big' }],
          },
        },
      });
    });
    expect(screen.getByRole('textbox', { name: '数量' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: '数量' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('数量只能是 0 到 99 的整数')).toBeInTheDocument();
    expect(screen.queryByText(generic)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rolls an optimistic write back, then the session watcher opens login with state.from', async () => {
    const user = userEvent.setup();
    signIn();
    queryState.data = { ownedCount: 2, wanted: true };
    renderBarBesideLogin();

    const own = screen.getByRole('button', { name: '我有' });
    const want = screen.getByRole('button', { name: '想要' });
    await user.click(want);
    expect(want).toHaveAttribute('aria-pressed', 'false');
    await act(async () => {
      calls[0]?.opts.onError?.(unauthorized);
    });
    expect(own).toHaveAttribute('aria-pressed', 'true');
    expect(want).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('登录已失效，请重新登录')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/\/login\|/)).not.toBeInTheDocument();

    await act(async () => {
      noteTrpcFailure(unauthorized);
    });
    expect(screen.getByText(/\/login\|/)).toHaveTextContent(
      '/login|{"from":"/cards/aurora-knight","notice":"sessionExpired"}',
    );
  });

  it('sends an expired byCard read to login instead of the load-failed box', () => {
    signIn();
    queryState.isError = true;
    queryState.error = {
      data: {
        code: 'UNAUTHORIZED',
        appCode: APP_ERROR_CODES.UNAUTHORIZED,
        path: 'collection.byCard',
      },
    };
    queryState.errorUpdateCount = 1;
    renderBar();

    expect(screen.queryByText('收藏状态加载失败')).not.toBeInTheDocument();
    act(() => {
      noteTrpcFailure(queryState.error);
    });
    expect(screen.getByText(/\/login\|/)).toHaveTextContent(
      '/login|{"from":"/cards/aurora-knight","notice":"sessionExpired"}',
    );
    expect(screen.queryByText('收藏状态加载失败')).not.toBeInTheDocument();
    expect(screen.queryByText('登录已失效，请重新登录')).not.toBeInTheDocument();
  });
});

describe('collection share', () => {
  const writeText = vi.fn();

  afterEach(() => {
    vi.useRealTimers();
  });

  function installClipboard() {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText },
    });
  }

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  it('copies the current address and clears the status text after 3 seconds', async () => {
    const user = userEvent.setup();
    installClipboard();
    signIn();
    renderBar();

    const share = screen.getByRole('button', { name: '分享' });
    await user.click(share);
    expect(await screen.findByText('链接已复制')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(document.activeElement).toBe(share);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3100));
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('链接已复制');
  }, 8000);

  it('leaves a failed copy in the status region', async () => {
    const user = userEvent.setup();
    writeText.mockRejectedValue(new Error('denied'));
    installClipboard();
    renderBar();

    const share = screen.getByRole('button', { name: '分享' });
    await user.click(share);
    expect(await screen.findByText('无法复制，请手动复制地址栏中的链接')).toBeInTheDocument();
    expect(document.activeElement).toBe(share);
  });

  it('stays quiet when the system share sheet is cancelled', async () => {
    const shareFn = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareFn });
    const user = userEvent.setup();
    renderBar();

    const share = screen.getByRole('button', { name: '分享' });
    await user.click(share);
    expect(shareFn).toHaveBeenCalledWith({
      title: '极光骑士',
      text: '极光骑士',
      url: window.location.href,
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).not.toHaveTextContent('链接已复制');
    expect(screen.getByRole('status')).not.toHaveTextContent('无法复制');
    expect(document.activeElement).toBe(share);
  });
});
