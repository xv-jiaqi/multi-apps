import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
const invalidateSeriesBySlug = vi.hoisted(() => vi.fn());

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
      series: { bySlug: { invalidate: invalidateSeriesBySlug } },
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
  seriesState.items = [
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
  ];
  createImpl.current = async (input) => input;
  invalidateSeriesBySlug.mockClear();
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

  it('stops new attributes at 40 and explains why', async () => {
    const user = userEvent.setup();
    cardState.data = {
      id: 'c1',
      slug: 'aurora-knight',
      name: '极光骑士',
      description: '',
      imageUrl: '',
      rarity: 'common',
      attributes: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`k${index}`, 'v'])),
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

    const add = screen.getByRole('button', { name: '添加属性' });
    expect(add).toBeDisabled();
    expect(screen.getByText('已有 40 个属性，最多 40 个')).toBeInTheDocument();
    const names = screen.getAllByRole('textbox', { name: /属性名/ });
    expect(names).toHaveLength(40);
    names[39]?.focus();
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('textbox', { name: /属性名/ })).toHaveLength(40);
  });

  it('marks a 41st attribute on the field and focuses that row', async () => {
    const user = userEvent.setup();
    cardState.data = {
      id: 'c1',
      slug: 'aurora-knight',
      name: '极光骑士',
      description: '',
      imageUrl: '',
      rarity: 'common',
      attributes: Object.fromEntries(Array.from({ length: 41 }, (_, index) => [`k${index}`, 'v'])),
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

    expect(screen.getByText('已有 41 个属性，最多 40 个')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    expect(screen.getByText('最多 40 个属性')).toBeInTheDocument();
    expect(screen.queryByText('At most 40 attributes')).not.toBeInTheDocument();
    expect(document.activeElement).toHaveValue('k40');
  });

  it('rejects an over-long attribute name and value on the row', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'aurora-knight');
    await user.type(screen.getByRole('textbox', { name: '名称' }), '极光骑士');
    await user.click(screen.getByRole('button', { name: '添加属性' }));
    fireEvent.change(screen.getByRole('textbox', { name: '第 1 行属性名' }), {
      target: { value: 'a'.repeat(65) },
    });
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(screen.getByText('属性名最长 64 个字符')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '第 1 行属性名' })).toHaveFocus();

    fireEvent.change(screen.getByRole('textbox', { name: '第 1 行属性名' }), {
      target: { value: 'cost' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '第 1 行的值' }), {
      target: { value: 'b'.repeat(501) },
    });
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(screen.getByText('属性值最长 500 个字符')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '第 1 行属性名' })).toHaveFocus();
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
            issues: [
              {
                code: 'too_big',
                maximum: 2048,
                path: ['imageUrl'],
                message: 'rejected by schema',
              },
            ],
          },
        },
      };
    };

    await submitNewCard(user);

    expect(await screen.findByText('图片链接最长 2048 个字符')).toBeInTheDocument();
    expect(screen.queryByText('rejected by schema')).not.toBeInTheDocument();
    expect(screen.queryByText(/Too big/)).not.toBeInTheDocument();
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

  it('puts the attribute cap on the attributes field and moves focus there', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: JSON.stringify([
          { code: 'custom', path: ['attributes'], message: 'limit exceeded' },
        ]),
        data: { code: 'BAD_REQUEST' },
      };
    };

    await submitNewCard(user);

    const attributes = document.getElementById('card-attributes');
    expect(attributes).toHaveTextContent('最多 40 个属性');
    expect(attributes).toHaveFocus();
    expect(screen.queryByText('limit exceeded')).not.toBeInTheDocument();
    expect(screen.queryByText('At most 40 attributes')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('translates an over-long attribute value from the server onto the attributes field', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: JSON.stringify([
          {
            code: 'too_big',
            maximum: 500,
            path: ['attributes', 'cost'],
            message: 'rejected by schema',
          },
        ]),
        data: { code: 'BAD_REQUEST' },
      };
    };

    await submitNewCard(user);

    expect(document.getElementById('card-attributes')).toHaveTextContent('属性值最长 500 个字符');
    expect(document.getElementById('card-attributes')).toHaveFocus();
    expect(screen.queryByText('rejected by schema')).not.toBeInTheDocument();
    expect(screen.queryByText(/Too big/)).not.toBeInTheDocument();
  });

  it('translates an invalid attribute key from its zod code', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: JSON.stringify([
          {
            code: 'invalid_key',
            path: ['attributes', 'k'.repeat(65)],
            message: 'bad key',
            issues: [{ code: 'too_big', maximum: 64, message: 'rejected by schema' }],
          },
        ]),
        data: { code: 'BAD_REQUEST' },
      };
    };

    await submitNewCard(user);

    expect(document.getElementById('card-attributes')).toHaveTextContent('属性名最长 64 个字符');
    expect(screen.queryByText('bad key')).not.toBeInTheDocument();
    expect(screen.queryByText('Invalid key in record')).not.toBeInTheDocument();
  });

  it('invalidates the previous series list when the card moves', async () => {
    const user = userEvent.setup();
    seriesState.items = [
      ...seriesState.items,
      {
        id: 's2',
        slug: 'forge-of-titans',
        title: '泰坦熔炉',
        description: null,
        coverUrl: null,
        cardCount: 0,
        commentCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z',
      },
    ];
    cardState.data = {
      id: 'c1',
      slug: 'aurora-knight',
      name: '极光骑士',
      description: '',
      imageUrl: '',
      rarity: 'legendary',
      attributes: {},
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

    await user.click(screen.getByRole('combobox', { name: '所属系列' }));
    await user.click(screen.getByRole('option', { name: '泰坦熔炉' }));
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(invalidateSeriesBySlug).toHaveBeenCalledWith({ slug: 'forge-of-titans' });
    expect(invalidateSeriesBySlug).toHaveBeenCalledWith({ slug: 'celestial-dawn' });
  });
});
