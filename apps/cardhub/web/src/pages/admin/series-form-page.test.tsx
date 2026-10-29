import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { rootStore } from '../../stores/root-store';

const seriesState = {
  items: [] as Array<Record<string, unknown>>,
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null as unknown,
  refetch: vi.fn(),
};

const createCalls: unknown[] = [];
const createImpl: { current: (input: unknown) => Promise<unknown> } = {
  current: async (input) => input,
};
const { invalidateAdminSeriesList, invalidateSeriesList, invalidateSeriesBySlug } = vi.hoisted(
  () => ({
    invalidateAdminSeriesList: vi.fn(),
    invalidateSeriesList: vi.fn(),
    invalidateSeriesBySlug: vi.fn(),
  }),
);

vi.mock('../../lib/trpc', () => ({
  trpc: {
    admin: {
      series: {
        list: {
          useQuery: () => ({
            data: seriesState.isError ? undefined : { items: seriesState.items },
            isLoading: seriesState.isLoading,
            isError: seriesState.isError,
            isFetching: seriesState.isFetching,
            error: seriesState.error,
            refetch: seriesState.refetch,
          }),
        },
        create: {
          useMutation: () => ({
            isPending: false,
            mutateAsync: async (input: unknown) => {
              createCalls.push(input);
              return createImpl.current(input);
            },
          }),
        },
        update: {
          useMutation: () => ({
            isPending: false,
            mutateAsync: async (input: unknown) => input,
          }),
        },
      },
      categories: {
        list: {
          useQuery: () => ({
            data: { items: [] },
            isLoading: false,
            isError: false,
            isFetching: false,
            error: null,
            refetch: vi.fn(),
          }),
        },
      },
    },
    search: {
      global: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
      },
    },
    useUtils: () => ({
      admin: { series: { list: { invalidate: invalidateAdminSeriesList } } },
      series: {
        list: { invalidate: invalidateSeriesList },
        bySlug: { invalidate: invalidateSeriesBySlug },
      },
    }),
  },
}));

import { EditSeriesPage, NewSeriesPage } from './series-form-page';

function renderSeries(path: string, entries?: string[]) {
  const initialEntries = entries ?? [path];
  const router = createMemoryRouter(
    [
      { path: '/admin/catalog/series/new', element: <NewSeriesPage /> },
      { path: '/admin/catalog/series/:slug/edit', element: <EditSeriesPage /> },
      { path: '/admin/catalog', element: <h1>目录</h1> },
      { path: '/', element: <h1>首页</h1> },
      { path: '/login', element: <h1>登录</h1> },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

const existing = {
  id: 's1',
  slug: 'celestial-dawn',
  title: '天穹黎明',
  description: '开端',
  coverUrl: 'gradient:from-sky-400-via-indigo-400-to-purple-500',
  cardCount: 1,
  commentCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  seriesState.items = [existing];
  seriesState.isLoading = false;
  seriesState.isError = false;
  seriesState.isFetching = false;
  createCalls.length = 0;
  createImpl.current = async (input) => input;
  invalidateAdminSeriesList.mockClear();
  invalidateSeriesList.mockClear();
  invalidateSeriesBySlug.mockClear();
});

describe('series form', () => {
  it('shows the slug as read-only text when editing', () => {
    renderSeries('/admin/catalog/series/celestial-dawn/edit');

    expect(screen.getByText('celestial-dawn')).toBeInTheDocument();
    expect(screen.getByText('创建后不能修改（网址和交易意向都依赖它）')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'slug' })).not.toBeInTheDocument();
  });

  it.each([
    ['', undefined],
    ['https://cdn.example/cover.png', 'https://cdn.example/cover.png'],
    ['gradient:from-sky-400', 'gradient:from-sky-400'],
  ])('accepts image value %j', async (value, expected) => {
    const user = userEvent.setup();
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    if (value) {
      await user.type(screen.getByRole('textbox', { name: '封面图片链接' }), value);
      await user.tab();
    }
    expect(screen.queryByText('请填写 https:// 开头的图片链接，或者留空')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(createCalls[0]).toMatchObject({
      slug: 'new-series',
      title: '新系列',
      coverUrl: expected,
    });
    expect(invalidateSeriesList).toHaveBeenCalledTimes(1);
    expect(invalidateSeriesBySlug).toHaveBeenCalledWith({ slug: 'new-series' });
  });

  it('shows slug_format under the field in the active language', async () => {
    const user = userEvent.setup();
    const zh = renderSeries('/admin/catalog/series/new');
    const slug = screen.getByRole('textbox', { name: /slug/i });
    await user.type(slug, 'Not A Slug');
    await user.tab();
    expect(screen.getByText('只能用小写字母、数字和短横线')).toBeInTheDocument();
    expect(screen.queryByText('slug_format')).not.toBeInTheDocument();
    expect(screen.queryByText(/kebab-case/)).not.toBeInTheDocument();
    zh.unmount();

    rootStore.locale.setLocale('en-US');
    renderSeries('/admin/catalog/series/new');
    const slugEn = screen.getByRole('textbox', { name: /slug/i });
    await user.type(slugEn, 'Not A Slug');
    await user.tab();
    expect(
      screen.getByText('Use lowercase letters, numbers, and hyphens only.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('slug_format')).not.toBeInTheDocument();
  });

  it('rejects http image links on blur and blocks submit', async () => {
    const user = userEvent.setup();
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.type(
      screen.getByRole('textbox', { name: '封面图片链接' }),
      'http://cdn.example/a.png',
    );
    await user.tab();
    expect(screen.getByText('请填写 https:// 开头的图片链接，或者留空')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(createCalls).toHaveLength(0);
    expect(screen.getByRole('textbox', { name: '封面图片链接' })).toHaveFocus();
  });

  it('shows the server validation message for a field instead of only the generic save failure', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: JSON.stringify([
          {
            code: 'too_big',
            maximum: 2048,
            path: ['coverUrl'],
            message: 'rejected by schema',
          },
        ]),
        data: { code: 'BAD_REQUEST' },
      };
    };
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('图片链接最长 2048 个字符')).toBeInTheDocument();
    expect(screen.queryByText('rejected by schema')).not.toBeInTheDocument();
    expect(screen.queryByText(/Too big/)).not.toBeInTheDocument();
    expect(screen.queryByText('保存失败，请重试')).not.toBeInTheDocument();
    expect(screen.queryByText('保存失败，请重试')).not.toBeInTheDocument();
    expect(screen.queryByText('BAD_REQUEST')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '封面图片链接' })).toHaveFocus();
  });

  it('translates an image-url refine from its zod code', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: JSON.stringify([{ code: 'custom', path: ['coverUrl'], message: 'not a url' }]),
        data: { code: 'BAD_REQUEST' },
      };
    };
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('请填写 https:// 开头的图片链接，或者留空')).toBeInTheDocument();
    expect(screen.queryByText('not a url')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '封面图片链接' })).toHaveFocus();
  });

  it('uses title_too_long for an over-long title and too_big for the description', async () => {
    const user = userEvent.setup();
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), {
      target: { value: '标'.repeat(121) },
    });
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('标题最多 120 个字符')).toBeInTheDocument();
    expect(screen.queryByText('内容超出长度限制')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), {
      target: { value: '新系列' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '简介' }), {
      target: { value: '介'.repeat(5001) },
    });
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('内容超出长度限制')).toBeInTheDocument();
    expect(screen.queryByText('标题最多 120 个字符')).not.toBeInTheDocument();
  });

  it('falls back to too_big when a server length error has no field code', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: JSON.stringify([
          { code: 'too_big', path: ['description'], message: 'rejected by schema', maximum: 5000 },
        ]),
        data: { code: 'BAD_REQUEST' },
      };
    };
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('内容超出长度限制')).toBeInTheDocument();
    expect(screen.queryByText('标题最多 120 个字符')).not.toBeInTheDocument();
    expect(screen.queryByText('rejected by schema')).not.toBeInTheDocument();
  });

  it('maps a title_too_long code on a server too_big issue', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: JSON.stringify([
          { code: 'too_big', path: ['title'], message: 'title_too_long', maximum: 120 },
        ]),
        data: { code: 'BAD_REQUEST' },
      };
    };
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('标题最多 120 个字符')).toBeInTheDocument();
    expect(screen.queryByText('title_too_long')).not.toBeInTheDocument();
    expect(screen.queryByText('超出字数上限')).not.toBeInTheDocument();
    expect(screen.queryByText('Too long')).not.toBeInTheDocument();
  });

  it('does not render a raw code when the server message has no zod error', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw { message: 'not_a_mapped_code', data: { code: 'BAD_REQUEST' } };
    };
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('出了点问题，请稍后再试');
    expect(alert).not.toHaveTextContent('not_a_mapped_code');
    expect(alert).not.toHaveTextContent('出错了：');
  });

  it('maps price_needs_currency instead of showing the code', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw { message: 'price_needs_currency', data: { code: 'BAD_REQUEST' } };
    };
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('先选货币，再填价格区间');
    expect(alert).not.toHaveTextContent('price_needs_currency');
  });

  it('shows a server message when the error has no field path', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: '封面链接最长 2048 个字符',
        data: { code: 'BAD_REQUEST' },
      };
    };
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('出错了：封面链接最长 2048 个字符');
    expect(screen.queryByText('保存失败，请重试')).not.toBeInTheDocument();
  });

  it('uses the generic save failure when the server message is only the tRPC code', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw { message: 'BAD_REQUEST', data: { code: 'BAD_REQUEST' } };
    };
    renderSeries('/admin/catalog/series/new');

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，请重试');
    expect(screen.queryByText(/出错了/)).not.toBeInTheDocument();
  });

  it('invalidates the public series list and detail after editing', async () => {
    const user = userEvent.setup();
    renderSeries('/admin/catalog/series/celestial-dawn/edit');

    await user.click(screen.getByRole('button', { name: '保存修改' }));
    expect(invalidateSeriesList).toHaveBeenCalledTimes(1);
    expect(invalidateSeriesBySlug).toHaveBeenCalledWith({ slug: 'celestial-dawn' });
    expect(invalidateAdminSeriesList).toHaveBeenCalledTimes(1);
  });
});

describe('series form unsaved changes', () => {
  it('asks on cancel, breadcrumb, and header links, and keeps the draft when staying', async () => {
    const user = userEvent.setup();
    const { router } = renderSeries('/admin/catalog/series/new');
    const title = screen.getByRole('textbox', { name: '标题' });
    await user.type(title, '草稿');

    await user.click(screen.getByRole('link', { name: '取消' }));
    expect(screen.getByRole('alertdialog', { name: '放弃未保存的修改？' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续编辑' })).toHaveFocus();
    expect(router.state.location.pathname).toBe('/admin/catalog/series/new');
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(title).toHaveValue('草稿');

    const crumbs = within(screen.getByRole('navigation', { name: '面包屑导航' }));
    await user.click(crumbs.getByRole('link', { name: '内容管理' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(crumbs.getByRole('link', { name: '内容管理' })).toHaveFocus();
    expect(title).toHaveValue('草稿');
    expect(router.state.location.pathname).toBe('/admin/catalog/series/new');

    const home = screen.getAllByRole('link', { name: '首页' })[0];
    expect(home).toBeDefined();
    await user.click(home!);
    await user.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('does not ask when an edit is reverted to the loaded value', async () => {
    const user = userEvent.setup();
    const { router } = renderSeries('/admin/catalog/series/celestial-dawn/edit');
    const title = screen.getByRole('textbox', { name: '标题' });
    expect(title).toHaveValue('天穹黎明');

    await user.type(title, 'x');
    await user.click(screen.getByRole('link', { name: '取消' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(title).toHaveValue('天穹黎明x');

    await user.type(title, '{Backspace}');
    await user.click(screen.getByRole('link', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/catalog');
  });

  it('does not ask after a successful create navigates away', async () => {
    const user = userEvent.setup();
    const { router } = renderSeries('/admin/catalog/series/new');
    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/catalog');
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('blocks browser back until the draft is discarded', async () => {
    const user = userEvent.setup();
    const { router } = renderSeries('/admin/catalog/series/new', [
      '/admin/catalog',
      '/admin/catalog/series/new',
    ]);
    await user.type(screen.getByRole('textbox', { name: '标题' }), '草稿');

    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/catalog/series/new');
    const key = router.state.location.key;

    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('草稿');
    expect(router.state.location.key).toBe(key);

    await act(async () => {
      await router.navigate(1);
    });
    expect(router.state.location.pathname).toBe('/admin/catalog/series/new');

    await act(async () => {
      await router.navigate(-1);
    });
    await user.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(router.state.location.pathname).toBe('/admin/catalog');
  });

  it('sends an expired session to login without the unsaved dialog', async () => {
    const user = userEvent.setup();
    const { router } = renderSeries('/admin/catalog/series/new');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '草稿');

    act(() => {
      rootStore.session.signOut();
    });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('drops the unsaved dialog when admin permission is revoked', async () => {
    const user = userEvent.setup();
    const { router } = renderSeries('/admin/catalog/series/new');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '草稿');
    await user.click(screen.getByRole('link', { name: '取消' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    act(() => {
      rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'user' });
    });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('仅管理员可以管理内容')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/catalog/series/new');
  });

  it('registers beforeunload only after the series form changes', async () => {
    const user = userEvent.setup();
    const added: EventListener[] = [];
    const originalAdd = window.addEventListener.bind(window);
    const addSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation((type, listener, options) => {
        if (type === 'beforeunload' && typeof listener === 'function') added.push(listener);
        originalAdd(type, listener, options);
      });

    renderSeries('/admin/catalog/series/new');
    expect(added).toHaveLength(0);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await user.type(screen.getByRole('textbox', { name: '标题' }), '草稿');
    expect(added).toHaveLength(1);
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    addSpy.mockRestore();
  });
});
