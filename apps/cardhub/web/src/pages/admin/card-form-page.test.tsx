import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
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
const updateImpl = vi.hoisted(() => ({
  current: async (input: unknown) => input,
}));
const fetchBasePage = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => ({ items: [] as Array<Record<string, unknown>> })),
);
const baseList = {
  total: 3,
  pageSize: 100,
  items: [
    { slug: 'base-card', name: '基础卡', cardNumber: '001', isParallel: false },
    { slug: 'foil', name: '金箔卡', cardNumber: '002', isParallel: true },
    { slug: 'other-series-card', name: '别的系列', cardNumber: '009', isParallel: false },
  ] as Array<Record<string, unknown>>,
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
          useMutation: () => ({
            isPending: false,
            mutateAsync: (input: unknown) => updateImpl.current(input),
          }),
        },
      },
      subsets: {
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
    cards: {
      listBySeries: {
        useQuery: () => ({
          data: {
            items: baseList.items,
            total: baseList.total,
            page: 1,
            pageSize: baseList.pageSize,
            parallelCount: 1,
            seriesTotal: 2,
          },
          isLoading: false,
          isFetching: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
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
      cards: { listBySeries: { fetch: (input: unknown) => fetchBasePage(input) } },
    }),
  },
}));

import { EditCardPage, NewCardPage } from './card-form-page';

function renderCard(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/admin/catalog/series/:slug/cards/new', element: <NewCardPage /> },
      { path: '/admin/catalog/cards/:slug/edit', element: <EditCardPage /> },
      { path: '/admin/catalog/series/:slug', element: <h1>系列卡牌</h1> },
      { path: '/admin/catalog', element: <h1>目录</h1> },
    ],
    { initialEntries: [path] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

function renderNew() {
  return renderCard('/admin/catalog/series/celestial-dawn/cards/new');
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
  updateImpl.current = async (input) => input;
  invalidateSeriesBySlug.mockClear();
  fetchBasePage.mockReset();
  fetchBasePage.mockResolvedValue({ items: [] });
  baseList.total = 3;
  baseList.pageSize = 100;
  baseList.items = [
    { slug: 'base-card', name: '基础卡', cardNumber: '001', isParallel: false },
    { slug: 'foil', name: '金箔卡', cardNumber: '002', isParallel: true },
    { slug: 'other-series-card', name: '别的系列', cardNumber: '009', isParallel: false },
  ];
});

describe('length copy', () => {
  it('uses too_big for an over-long name, description, and card number', async () => {
    const user = userEvent.setup();
    renderNew();

    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'aurora-knight');
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), {
      target: { value: '名'.repeat(121) },
    });
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('内容超出长度限制')).toBeInTheDocument();
    expect(screen.queryByText('标题最多 120 个字符')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), {
      target: { value: '极光骑士' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '简介' }), {
      target: { value: '介'.repeat(5001) },
    });
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(screen.getByText('内容超出长度限制')).toBeInTheDocument();
    expect(screen.queryByText('标题最多 120 个字符')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '简介' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '卡号' }), {
      target: { value: '1'.repeat(21) },
    });
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(screen.getByText('内容超出长度限制')).toBeInTheDocument();
    expect(screen.queryByText('标题最多 120 个字符')).not.toBeInTheDocument();
  });
});

describe('long description (CH-206 §11-2)', () => {
  it('rejects more than 20000 characters on the field with card_body_too_long and focuses it', async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'aurora-knight');
    await user.type(screen.getByRole('textbox', { name: '名称' }), '极光骑士');
    const body = document.getElementById('card-body') as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: '长'.repeat(20001) } });
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText('长描述最多 20000 个字符')).toBeInTheDocument();
    expect(body).toHaveFocus();
    expect(body).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(body, { target: { value: '长'.repeat(20000) } });
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(screen.queryByText('长描述最多 20000 个字符')).not.toBeInTheDocument();
  });
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
    renderCard('/admin/catalog/cards/aurora-knight/edit');

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
    renderCard('/admin/catalog/cards/aurora-knight/edit');

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
    renderCard('/admin/catalog/cards/aurora-knight/edit');

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
      'attributes.cost: 出了点问题，请稍后再试',
    );
    expect(screen.queryByText(/Invalid input/)).not.toBeInTheDocument();
    expect(screen.queryByText(/expected number/)).not.toBeInTheDocument();
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

  it('shows an over-long card number under the card number field', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: '填写的内容不符合要求，请修改后再试',
        data: {
          code: 'BAD_REQUEST',
          appCode: 'VALIDATION',
          zodError: {
            issues: [
              {
                code: 'too_big',
                maximum: 20,
                path: ['cardNumber'],
                message: '填写的内容不符合要求，请修改后再试',
              },
            ],
          },
        },
      };
    };

    await submitNewCard(user);

    const input = screen.getByRole('textbox', { name: '卡号' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', expect.stringContaining('card-number-error'));
    expect(document.getElementById('card-number-error')).toHaveTextContent('内容超出长度限制');
    expect(screen.queryByText(/cardNumber/)).not.toBeInTheDocument();
    const alert = screen.queryByRole('alert');
    if (alert) expect(alert).not.toHaveTextContent('cardNumber');
  });

  it('shows a server subset slug error under the subset control', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: '填写的内容不符合要求，请修改后再试',
        data: {
          code: 'BAD_REQUEST',
          appCode: 'VALIDATION',
          zodError: {
            issues: [
              {
                code: 'custom',
                path: ['subsetSlug'],
                message: 'slug_format',
              },
            ],
          },
        },
      };
    };

    await submitNewCard(user);

    const subset = document.getElementById('card-subset');
    expect(subset).toHaveAttribute('aria-invalid', 'true');
    expect(subset).toHaveAttribute('aria-describedby', 'card-subset-error');
    expect(document.getElementById('card-subset-error')).toHaveTextContent(
      '只能用小写字母、数字和短横线',
    );
    expect(screen.queryByText(/subsetSlug/)).not.toBeInTheDocument();
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
    renderCard('/admin/catalog/cards/aurora-knight/edit');

    await user.click(screen.getByRole('combobox', { name: '所属系列' }));
    await user.click(screen.getByRole('option', { name: '泰坦熔炉' }));
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(invalidateSeriesBySlug).toHaveBeenCalledWith({ slug: 'forge-of-titans' });
    expect(invalidateSeriesBySlug).toHaveBeenCalledWith({ slug: 'celestial-dawn' });
  });
});

describe('card form parallels', () => {
  async function fillBase(user: ReturnType<typeof userEvent.setup>, slug = 'aurora-knight') {
    renderNew();
    await user.type(screen.getByRole('textbox', { name: 'slug' }), slug);
    await user.type(screen.getByRole('textbox', { name: '名称' }), '极光骑士');
  }

  it('rejects printRun 0 on the field and does not offer a parallel as a base', async () => {
    const user = userEvent.setup();
    await fillBase(user);
    expect(screen.queryByRole('textbox', { name: '平行名称' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: '基础卡' }));
    expect(screen.getByRole('option', { name: '001 基础卡' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /金箔/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    const printRun = screen.getByRole('textbox', { name: '限量总数' });
    expect(printRun).toHaveAttribute('inputMode', 'numeric');
    expect(printRun).toHaveAttribute('autocomplete', 'off');
    await user.type(printRun, '0');
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(document.getElementById('card-print-run-error')).toHaveTextContent(
      '限量数量至少为 1，不限量请留空',
    );
    expect(printRun).toHaveAttribute('aria-invalid', 'true');
    expect(printRun).toHaveFocus();
  });

  it('shows parallel_self when the new card slug is the selected base', async () => {
    const user = userEvent.setup();
    await fillBase(user);
    await user.click(screen.getByRole('combobox', { name: '基础卡' }));
    await user.click(screen.getByRole('option', { name: '001 基础卡' }));
    const slug = screen.getByRole('textbox', { name: 'slug' });
    await user.clear(slug);
    await user.type(slug, 'base-card');
    await user.type(screen.getByRole('textbox', { name: '平行名称' }), '金箔');
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(document.getElementById('card-parallel-of-error')).toHaveTextContent(
      '不能把卡设为自己的平行版本',
    );
    expect(document.getElementById('card-parallel-of')).toHaveFocus();
  });

  it('shows parallel_chain and parallel_cross_series from the server on the base field', async () => {
    const user = userEvent.setup();
    createImpl.current = async () => {
      throw {
        message: '填写的内容不符合要求，请修改后再试',
        data: {
          code: 'BAD_REQUEST',
          zodError: {
            issues: [{ code: 'custom', path: ['parallelOfSlug'], message: 'parallel_chain' }],
          },
        },
      };
    };
    await fillBase(user);
    await user.click(screen.getByRole('combobox', { name: '基础卡' }));
    await user.click(screen.getByRole('option', { name: '001 基础卡' }));
    await user.type(screen.getByRole('textbox', { name: '平行名称' }), '金箔');
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText('只能挂到基础卡，不能挂到平行版本')).toBeInTheDocument();
    expect(document.getElementById('card-parallel-of')).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('card-parallel-of')).toHaveFocus();

    createImpl.current = async () => {
      throw {
        message: '填写的内容不符合要求，请修改后再试',
        data: {
          code: 'BAD_REQUEST',
          zodError: {
            issues: [
              { code: 'custom', path: ['parallelOfSlug'], message: 'parallel_cross_series' },
            ],
          },
        },
      };
    };
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText('基础卡必须属于同一系列')).toBeInTheDocument();
    expect(screen.queryByText('只能挂到基础卡，不能挂到平行版本')).not.toBeInTheDocument();
    expect(document.getElementById('card-parallel-of')).toHaveFocus();
  });

  it('clears the base card when the series changes', async () => {
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
    await fillBase(user);
    await user.click(screen.getByRole('combobox', { name: '基础卡' }));
    await user.click(screen.getByRole('option', { name: '001 基础卡' }));
    await user.type(screen.getByRole('textbox', { name: '平行名称' }), '金箔');
    await user.click(screen.getByRole('combobox', { name: '所属系列' }));
    await user.click(screen.getByRole('option', { name: '泰坦熔炉' }));
    expect(screen.getByRole('status')).toHaveTextContent('已清空基础卡：系列已更改');
    expect(screen.queryByRole('textbox', { name: '平行名称' })).not.toBeInTheDocument();
  });
});

describe('card form base card pages', () => {
  it('includes base cards from later pages', async () => {
    const user = userEvent.setup();
    baseList.total = 101;
    baseList.pageSize = 100;
    baseList.items = [{ slug: 'base-card', name: '基础卡', cardNumber: '001', isParallel: false }];
    fetchBasePage.mockResolvedValue({
      items: [{ slug: 'later-base', name: '后页卡', cardNumber: '101', isParallel: false }],
    });
    renderNew();
    const baseSelect = await screen.findByRole('combobox', { name: '基础卡' });
    await user.click(baseSelect);
    expect(await screen.findByRole('option', { name: '101 后页卡' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '001 基础卡' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /金箔/ })).not.toBeInTheDocument();
    expect(fetchBasePage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 100, includeParallels: false }),
    );
  });

  it('shows an error when a later base-card page fails', async () => {
    baseList.total = 101;
    baseList.pageSize = 100;
    baseList.items = [{ slug: 'base-card', name: '基础卡', cardNumber: '001', isParallel: false }];
    fetchBasePage.mockRejectedValue(new Error('later page failed'));
    renderNew();
    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败');
    expect(screen.queryByRole('combobox', { name: '基础卡' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '001 基础卡' })).not.toBeInTheDocument();
  });
});

describe('card form unsaved changes', () => {
  const savedCard = {
    id: 'c1',
    slug: 'aurora-knight',
    name: '极光骑士',
    description: '',
    imageUrl: '',
    rarity: 'legendary' as const,
    attributes: { cost: 4, type: '随从', taunt: true },
    seriesSlug: 'celestial-dawn',
    seriesTitle: '天穹黎明',
    commentCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };

  it('treats an attribute value that is changed and restored as clean', async () => {
    const user = userEvent.setup();
    cardState.data = savedCard;
    const { router } = renderCard('/admin/catalog/cards/aurora-knight/edit');
    const value = screen.getByRole('textbox', { name: '第 2 行的值' });
    expect(value).toHaveValue('随从');

    await user.type(value, 'x');
    await user.click(screen.getByRole('link', { name: '取消' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(value).toHaveValue('随从x');

    await user.type(value, '{Backspace}');
    await user.click(screen.getByRole('link', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/catalog/series/celestial-dawn');
  });

  it('asks when a blank attribute row was added, and keeps it if the user stays', async () => {
    const user = userEvent.setup();
    const { router } = renderNew();
    await user.click(screen.getByRole('button', { name: '添加属性' }));
    await user.click(screen.getByRole('link', { name: '取消' }));

    expect(screen.getByRole('alertdialog', { name: '放弃未保存的修改？' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/catalog/series/celestial-dawn/cards/new');
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '第 1 行属性名' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/catalog/series/celestial-dawn/cards/new');
  });

  it('does not ask after a successful create navigates to the series', async () => {
    const user = userEvent.setup();
    const { router } = renderNew();
    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'aurora-knight');
    await user.type(screen.getByRole('textbox', { name: '名称' }), '极光骑士');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/catalog/series/celestial-dawn');
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the stored parallel name when saving an orphan', async () => {
    const user = userEvent.setup();
    const calls: Array<Record<string, unknown>> = [];
    updateImpl.current = async (input) => {
      calls.push(input as Record<string, unknown>);
      return input;
    };
    cardState.data = {
      ...savedCard,
      parallelOfSlug: null,
      parallelName: '孤儿X',
      printRun: 7,
    };
    const { router } = renderCard('/admin/catalog/cards/aurora-knight/edit');
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/catalog/series/celestial-dawn');
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.parallelOfSlug).toBe('');
    expect(calls[0]?.parallelName).toBe('孤儿X');
  });

  it('clears the parallel name when an existing parallel moves to another series', async () => {
    const user = userEvent.setup();
    const calls: Array<Record<string, unknown>> = [];
    updateImpl.current = async (input) => {
      calls.push(input as Record<string, unknown>);
      return input;
    };
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
      ...savedCard,
      parallelOfSlug: 'base-card',
      parallelName: '金箔',
      printRun: 7,
    };
    renderCard('/admin/catalog/cards/aurora-knight/edit');
    await user.click(screen.getByRole('combobox', { name: '所属系列' }));
    await user.click(screen.getByRole('option', { name: '泰坦熔炉' }));
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.seriesSlug).toBe('forge-of-titans');
    expect(calls[0]?.parallelOfSlug).toBe('');
    expect(calls[0]?.parallelName).toBe('');
  });

  it('clears the parallel name when the base card is set to none', async () => {
    const user = userEvent.setup();
    const calls: Array<Record<string, unknown>> = [];
    updateImpl.current = async (input) => {
      calls.push(input as Record<string, unknown>);
      return input;
    };
    cardState.data = {
      ...savedCard,
      parallelOfSlug: 'base-card',
      parallelName: '金箔',
      printRun: 7,
    };
    renderCard('/admin/catalog/cards/aurora-knight/edit');
    await user.click(screen.getByRole('combobox', { name: '基础卡' }));
    await user.click(screen.getByRole('option', { name: '无（这是基础卡）' }));
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.parallelOfSlug).toBe('');
    expect(calls[0]?.parallelName).toBe('');
  });
});
