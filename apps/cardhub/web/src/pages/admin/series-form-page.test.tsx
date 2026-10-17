import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
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
  createCalls.length = 0;
  createImpl.current = async (input) => input;
  invalidateAdminSeriesList.mockClear();
  invalidateSeriesList.mockClear();
  invalidateSeriesBySlug.mockClear();
});

describe('series form', () => {
  it('shows the slug as read-only text when editing', () => {
    render(
      <MemoryRouter initialEntries={['/admin/catalog/series/celestial-dawn/edit']}>
        <Routes>
          <Route path="/admin/catalog/series/:slug/edit" element={<EditSeriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

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
    render(
      <MemoryRouter initialEntries={['/admin/catalog/series/new']}>
        <Routes>
          <Route path="/admin/catalog/series/new" element={<NewSeriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

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

  it('rejects http image links on blur and blocks submit', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/catalog/series/new']}>
        <Routes>
          <Route path="/admin/catalog/series/new" element={<NewSeriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

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
            path: ['coverUrl'],
            message: 'Too big: expected string to have <=2048 characters',
          },
        ]),
        data: { code: 'BAD_REQUEST' },
      };
    };
    render(
      <MemoryRouter initialEntries={['/admin/catalog/series/new']}>
        <Routes>
          <Route path="/admin/catalog/series/new" element={<NewSeriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(
      await screen.findByText('Too big: expected string to have <=2048 characters'),
    ).toBeInTheDocument();
    expect(screen.queryByText('保存失败，请重试')).not.toBeInTheDocument();
    expect(screen.queryByText('BAD_REQUEST')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '封面图片链接' })).toHaveFocus();
  });

  it('shows a server message when the error has no field path', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: '封面链接最长 2048 个字符',
        data: { code: 'BAD_REQUEST' },
      };
    };
    render(
      <MemoryRouter initialEntries={['/admin/catalog/series/new']}>
        <Routes>
          <Route path="/admin/catalog/series/new" element={<NewSeriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

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
    render(
      <MemoryRouter initialEntries={['/admin/catalog/series/new']}>
        <Routes>
          <Route path="/admin/catalog/series/new" element={<NewSeriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'new-series');
    await user.type(screen.getByRole('textbox', { name: '标题' }), '新系列');
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，请重试');
    expect(screen.queryByText(/出错了/)).not.toBeInTheDocument();
  });

  it('invalidates the public series list and detail after editing', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/catalog/series/celestial-dawn/edit']}>
        <Routes>
          <Route path="/admin/catalog/series/:slug/edit" element={<EditSeriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: '保存修改' }));
    expect(invalidateSeriesList).toHaveBeenCalledTimes(1);
    expect(invalidateSeriesBySlug).toHaveBeenCalledWith({ slug: 'celestial-dawn' });
    expect(invalidateAdminSeriesList).toHaveBeenCalledTimes(1);
  });
});
