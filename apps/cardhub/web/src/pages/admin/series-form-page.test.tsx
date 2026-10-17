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
              return input;
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
    useUtils: () => ({
      admin: { series: { list: { invalidate: vi.fn() } } },
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
});
