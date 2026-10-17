import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../../stores/root-store';

const seriesState = {
  items: [
    {
      id: 's1',
      slug: 'celestial-dawn',
      title: '天穹黎明',
      description: null,
      coverUrl: null,
      cardCount: 1,
      commentCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    },
  ],
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null as unknown,
  refetch: vi.fn(),
};

const createImpl: { current: (input: unknown) => Promise<unknown> } = {
  current: async (input) => input,
};

const cardState = {
  data: null as unknown,
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null as unknown,
  refetch: vi.fn(),
};

vi.mock('../../lib/trpc', () => ({
  trpc: {
    admin: {
      series: {
        list: {
          useQuery: () => ({
            data: { items: seriesState.items },
            isLoading: seriesState.isLoading,
            isError: seriesState.isError,
            isFetching: seriesState.isFetching,
            error: seriesState.error,
            refetch: seriesState.refetch,
          }),
        },
      },
      cards: {
        get: { useQuery: () => cardState },
        create: {
          useMutation: () => ({
            isPending: false,
            mutateAsync: (input: unknown) => createImpl.current(input),
          }),
        },
        update: {
          useMutation: () => ({ isPending: false, mutateAsync: async (input: unknown) => input }),
        },
      },
    },
    search: {
      global: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
      },
    },
    useUtils: () => ({
      admin: {
        series: { list: { invalidate: vi.fn() } },
        cards: { get: { invalidate: vi.fn() } },
      },
      series: { bySlug: { invalidate: vi.fn() } },
    }),
  },
}));

import { EditCardPage, NewCardPage } from './card-form-page';

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/admin/catalog/series/celestial-dawn/cards/new']}>
      <Routes>
        <Route path="/admin/catalog/series/:slug/cards/new" element={<NewCardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  cardState.data = null;
  cardState.isLoading = false;
  cardState.isError = false;
  createImpl.current = async (input) => input;
});

describe('attributes editor', () => {
  it('infers text, number and boolean types from the saved card', () => {
    cardState.data = {
      id: 'c1',
      slug: 'aurora-knight',
      name: '极光骑士',
      description: '',
      imageUrl: 'gradient:from-sky-200',
      rarity: 'legendary',
      attributes: { cost: 4, type: '随从', taunt: true },
      seriesSlug: 'celestial-dawn',
      seriesTitle: '天穹黎明',
      commentCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    render(
      <MemoryRouter initialEntries={['/admin/catalog/cards/aurora-knight/edit']}>
        <Routes>
          <Route path="/admin/catalog/cards/:slug/edit" element={<EditCardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('aurora-knight')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'slug' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '第 1 行类型' })).toHaveTextContent('数字');
    expect(screen.getByRole('textbox', { name: '第 1 行的值' })).toHaveValue('4');
    expect(screen.getByRole('combobox', { name: '第 2 行类型' })).toHaveTextContent('文本');
    expect(screen.getByRole('textbox', { name: '第 2 行的值' })).toHaveValue('随从');
    expect(screen.getByRole('combobox', { name: '第 3 行类型' })).toHaveTextContent('是 / 否');
    expect(screen.getByRole('combobox', { name: '第 3 行的值' })).toHaveTextContent('是');
  });

  it('adds a row on Enter in the last row and moves to the next row otherwise', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByRole('button', { name: '添加属性' }));
    expect(screen.getByRole('textbox', { name: '第 1 行属性名' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: '第 2 行属性名' })).toHaveFocus();
    screen.getByRole('textbox', { name: '第 1 行属性名' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: '第 2 行属性名' })).toHaveFocus();
    expect(screen.getAllByRole('textbox', { name: /属性名/ })).toHaveLength(2);
  });

  it('reports duplicate names and moves focus after a row is removed', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByRole('button', { name: '添加属性' }));
    await user.type(screen.getByRole('textbox', { name: '第 1 行属性名' }), 'Cost');
    await user.keyboard('{Enter}');
    await user.type(screen.getByRole('textbox', { name: '第 2 行属性名' }), 'cost');
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(screen.getAllByText('属性名重复')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '删除属性「Cost」' }));
    expect(screen.getByRole('textbox', { name: '第 1 行属性名' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: '第 1 行属性名' })).toHaveValue('cost');

    await user.click(screen.getByRole('button', { name: '删除属性「cost」' }));
    expect(screen.getByRole('button', { name: '添加属性' })).toHaveFocus();
  });
});

describe('card form server validation', () => {
  async function submitNewCard(user: ReturnType<typeof userEvent.setup>) {
    renderNew();
    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'aurora-knight');
    await user.type(screen.getByRole('textbox', { name: '名称' }), '极光骑士');
    await user.click(screen.getByRole('button', { name: '创建' }));
  }

  it('shows a field-level zod error instead of only the generic save failure', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: 'BAD_REQUEST',
        data: {
          code: 'BAD_REQUEST',
          zodError: {
            formErrors: [],
            fieldErrors: {
              imageUrl: ['Too big: expected string to have <=2048 characters'],
            },
          },
        },
      };
    };

    await submitNewCard(user);

    expect(
      await screen.findByText('Too big: expected string to have <=2048 characters'),
    ).toBeInTheDocument();
    expect(screen.queryByText('保存失败，请重试')).not.toBeInTheDocument();
    expect(screen.queryByText('BAD_REQUEST')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '卡图链接' })).toHaveFocus();
  });

  it('shows a nested zod path from the server message', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: JSON.stringify([
          {
            path: ['attributes', 'cost'],
            message: 'Invalid input: expected number, received object',
          },
        ]),
        data: { code: 'BAD_REQUEST' },
      };
    };

    await submitNewCard(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'attributes.cost: Invalid input: expected number, received object',
    );
    expect(screen.queryByText('保存失败，请重试')).not.toBeInTheDocument();
  });
});
