import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../../stores/root-store';

const seriesState = {
  items: [] as Array<Record<string, unknown>>,
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null as unknown,
  refetch: vi.fn(),
};

const deleteCalls: Array<{ slug: string; force?: boolean }> = [];
const deleteImpl: {
  current: (input: { slug: string; force?: boolean }) => Promise<unknown>;
} = {
  current: async (input) => ({ ok: true, slug: input.slug, cardCount: 0, commentCount: 0 }),
};

let listCalls = 0;

vi.mock('../../lib/trpc', () => ({
  trpc: {
    admin: {
      series: {
        list: {
          useQuery: () => {
            listCalls += 1;
            return {
              data: seriesState.isError ? undefined : { items: seriesState.items },
              isLoading: seriesState.isLoading,
              isError: seriesState.isError,
              isFetching: seriesState.isFetching,
              error: seriesState.error,
              refetch: seriesState.refetch,
            };
          },
        },
        delete: {
          useMutation: () => ({
            isPending: false,
            mutateAsync: (input: { slug: string; force?: boolean }) => {
              deleteCalls.push(input);
              return deleteImpl.current(input);
            },
          }),
        },
      },
    },
    useUtils: () => ({
      admin: { series: { list: { invalidate: vi.fn() } } },
      series: { list: { invalidate: vi.fn() } },
    }),
  },
}));

import { CatalogSeriesPage } from './catalog-series';

const quiet = {
  id: 's1',
  slug: 'quiet-series',
  title: '安静',
  description: null,
  coverUrl: null,
  cardCount: 0,
  commentCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-01T08:00:00.000Z',
};

const forge = {
  id: 's2',
  slug: 'forge-of-titans',
  title: '泰坦熔炉',
  description: null,
  coverUrl: 'gradient:from-orange-500-via-red-500-to-rose-700',
  cardCount: 12,
  commentCount: 37,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-02T08:00:00.000Z',
};

function renderPage() {
  return render(
    <MemoryRouter>
      <CatalogSeriesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  seriesState.items = [];
  seriesState.isLoading = false;
  seriesState.isError = false;
  seriesState.isFetching = false;
  seriesState.error = null;
  deleteCalls.length = 0;
  listCalls = 0;
  deleteImpl.current = async (input) => ({
    ok: true,
    slug: input.slug,
    cardCount: 0,
    commentCount: 0,
  });
});

describe('CatalogSeriesPage access', () => {
  it('asks anonymous visitors to sign in and does not call admin APIs', () => {
    rootStore.session.signOut();
    renderPage();
    expect(screen.getByRole('link', { name: '请先登录管理员账号' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(listCalls).toBe(0);
  });

  it('tells signed-in non-admins they cannot manage content', () => {
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    renderPage();
    expect(screen.getByText('仅管理员可以管理内容')).toBeInTheDocument();
    expect(listCalls).toBe(0);
  });

  it('switches the page to the admin-only state when the API returns FORBIDDEN', async () => {
    seriesState.isError = true;
    seriesState.error = { message: '仅管理员可管理内容', data: { code: 'FORBIDDEN' } };
    renderPage();
    expect(await screen.findByText('仅管理员可以管理内容')).toBeInTheDocument();
    expect(screen.queryByText('FORBIDDEN')).not.toBeInTheDocument();
  });
});

describe('CatalogSeriesPage delete', () => {
  it('deletes an empty series with inline confirmation and returns focus on cancel', async () => {
    const user = userEvent.setup();
    seriesState.items = [quiet];
    renderPage();

    await user.click(screen.getByRole('button', { name: '删除「安静」' }));
    expect(
      screen.getByRole('group', { name: '删除系列「安静」？此操作不可撤销。' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除「安静」' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '删除「安静」' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(deleteCalls).toEqual([{ slug: 'quiet-series', force: false }]);
    expect(await screen.findByRole('status')).toHaveTextContent('已删除系列「安静」');
    expect(screen.queryByRole('link', { name: '安静' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveFocus();
  });

  it('opens the force dialog for a series that still has cards', async () => {
    const user = userEvent.setup();
    seriesState.items = [forge];
    deleteImpl.current = async (input) => ({
      ok: true,
      slug: input.slug,
      cardCount: 12,
      commentCount: 37,
    });
    renderPage();

    await user.click(screen.getByRole('button', { name: '删除「泰坦熔炉」' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('12 张卡牌');
    expect(dialog).toHaveTextContent('37 条评论');
    expect(dialog).not.toHaveTextContent('SERIES_HAS_CARDS');
    const confirm = screen.getByRole('button', { name: '永久删除' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveFocus();

    await user.type(screen.getByRole('textbox'), ' Forge-of-titans ');
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), ' forge-of-titans ');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(deleteCalls.at(-1)).toEqual({ slug: 'forge-of-titans', force: true });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      '已删除系列「泰坦熔炉」和 12 张卡牌',
    );
  });

  it('uses English plural forms for one and many cards and comments', async () => {
    const user = userEvent.setup();
    rootStore.locale.setLocale('en-US');
    seriesState.items = [{ ...forge, cardCount: 1, commentCount: 1 }];
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Delete “泰坦熔炉”' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('1 card');
    expect(dialog).toHaveTextContent('1 comment');
    expect(dialog).not.toHaveTextContent('1 cards');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    cleanup();
    seriesState.items = [
      { ...forge, title: 'Twin Forge', slug: 'twin-forge', cardCount: 2, commentCount: 0 },
    ];
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Delete “Twin Forge”' }));
    dialog = screen.getAllByRole('alertdialog').at(-1)!;
    expect(dialog).toHaveTextContent('2 cards');
    expect(dialog).toHaveTextContent('0 comments');
  });

  it('opens the force dialog with server counts when delete returns SERIES_HAS_CARDS', async () => {
    const user = userEvent.setup();
    seriesState.items = [quiet];
    deleteImpl.current = async () => {
      throw {
        message: 'SERIES_HAS_CARDS',
        data: {
          code: 'FORBIDDEN',
          adminCatalogError: { code: 'SERIES_HAS_CARDS', cardCount: 4, commentCount: 2 },
        },
      };
    };
    renderPage();

    await user.click(screen.getByRole('button', { name: '删除「安静」' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('4 张卡牌');
    expect(dialog).toHaveTextContent('2 条评论');
    expect(screen.queryByText('SERIES_HAS_CARDS')).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('shows a translated delete failure inside the dialog', async () => {
    const user = userEvent.setup();
    seriesState.items = [forge];
    deleteImpl.current = async () => {
      throw {
        message: 'SLUG_TAKEN',
        data: { code: 'CONFLICT', adminCatalogError: { code: 'SLUG_TAKEN' } },
      };
    };
    renderPage();
    await user.click(screen.getByRole('button', { name: '删除「泰坦熔炉」' }));
    await user.type(screen.getByRole('textbox'), 'forge-of-titans');
    await user.click(screen.getByRole('button', { name: '永久删除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('这个 slug 已被占用');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByText('SLUG_TAKEN')).not.toBeInTheDocument();
  });
});
