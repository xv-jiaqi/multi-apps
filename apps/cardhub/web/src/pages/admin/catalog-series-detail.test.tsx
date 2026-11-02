import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../../stores/root-store';

const subsetCreate = vi.hoisted(() => ({
  current: async (input: unknown): Promise<unknown> => input,
}));

const seriesState = {
  items: [] as Array<Record<string, unknown>>,
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null as unknown,
  refetch: vi.fn(),
};

const cardsState = {
  data: { cards: [] } as { cards: unknown[] } | undefined,
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
            data: seriesState.isError ? undefined : { items: seriesState.items },
            isLoading: seriesState.isLoading,
            isError: seriesState.isError,
            isFetching: seriesState.isFetching,
            error: seriesState.error,
            refetch: seriesState.refetch,
          }),
        },
      },
      cards: {
        delete: {
          useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
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
        create: {
          useMutation: () => ({
            isPending: false,
            mutateAsync: (input: unknown) => subsetCreate.current(input),
          }),
        },
        update: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
        delete: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      },
    },
    series: {
      bySlug: {
        useQuery: () => cardsState,
      },
    },
    search: {
      global: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
      },
    },
    useUtils: () => ({
      admin: { series: { list: { invalidate: vi.fn() } } },
      series: { bySlug: { invalidate: vi.fn() } },
    }),
  },
}));

import { CatalogSeriesDetailPage } from './catalog-series-detail';

const forge = {
  id: 's2',
  slug: 'forge-of-titans',
  title: '泰坦熔炉',
  description: null,
  coverUrl: null,
  cardCount: 2,
  commentCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-02T08:00:00.000Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/catalog/series/forge-of-titans']}>
      <Routes>
        <Route path="/admin/catalog/series/:slug" element={<CatalogSeriesDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  subsetCreate.current = async (input) => input;
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  seriesState.items = [forge];
  seriesState.isLoading = false;
  seriesState.isError = false;
  seriesState.isFetching = false;
  cardsState.data = { cards: [] };
  cardsState.isLoading = false;
  cardsState.isError = false;
  cardsState.isFetching = false;
});

describe('catalog series detail title', () => {
  it('puts the series name in the heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '泰坦熔炉 的卡牌' })).toBeInTheDocument();
    expect(screen.queryByText('{series}')).not.toBeInTheDocument();
  });

  it('uses the slug until the series title has loaded', () => {
    seriesState.items = [];
    seriesState.isLoading = true;
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'forge-of-titans 的卡牌' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('{series}')).not.toBeInTheDocument();
  });
});

describe('parallel badges', () => {
  const longName = '金箔超长平行名称金箔超长平行名称金箔超长';

  beforeEach(() => {
    cardsState.data = {
      cards: [
        {
          id: 'c1',
          slug: 'aurora-base',
          name: '极光骑士',
          rarity: 'rare',
          imageUrl: null,
          parallelName: null,
          printRun: null,
          parallelOfId: null,
        },
        {
          id: 'c2',
          slug: 'aurora-foil',
          name: '极光骑士',
          rarity: 'rare',
          imageUrl: null,
          parallelName: longName,
          printRun: 99,
          parallelOfId: 'c1',
        },
        {
          id: 'c3',
          slug: 'aurora-plain',
          name: '素银骑士',
          rarity: 'common',
          imageUrl: null,
          parallelName: '素银',
          printRun: null,
          parallelOfId: 'c1',
        },
      ],
    };
  });

  it('shows parallel and limited badges after the name and keeps the columns', () => {
    renderPage();
    const headers = screen.getAllByRole('rowheader');
    const base = headers.find((header) => header.textContent === '极光骑士');
    const foil = headers.find((header) => header.textContent?.includes(longName));
    const plain = screen.getByRole('rowheader', { name: /素银骑士/ });
    expect(base).toBeTruthy();
    expect(base).not.toHaveTextContent('平行');
    expect(base).not.toHaveTextContent('不编号');
    expect(foil).toHaveTextContent(`平行 · ${longName}`);
    expect(foil).toHaveTextContent('限量 /99');
    expect(foil?.querySelector('[title]')?.getAttribute('title')).toBe(longName);
    expect(plain).toHaveTextContent('平行 · 素银');
    expect(plain).not.toHaveTextContent('不编号');
    expect(screen.getByRole('columnheader', { name: '名称' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '稀有度' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '泰坦熔炉 的卡牌' })).toBeInTheDocument();
  });

  it('keeps the loading skeleton from scrolling sideways', () => {
    cardsState.isLoading = true;
    cardsState.data = undefined;
    renderPage();
    const table = screen.getByRole('table', { name: '泰坦熔炉 的卡牌' });
    expect(table.parentElement).toHaveClass('max-w-full');
    expect(table.parentElement).not.toHaveClass('overflow-x-auto');
  });
});

describe('subset form server validation', () => {
  it('shows a server sort order error under the sort field', async () => {
    const user = userEvent.setup();
    subsetCreate.current = async () => {
      throw {
        message: '填写的内容不符合要求，请修改后再试',
        data: {
          code: 'BAD_REQUEST',
          appCode: 'VALIDATION',
          zodError: {
            issues: [
              {
                code: 'too_big',
                path: ['sortOrder'],
                message: '填写的内容不符合要求，请修改后再试',
              },
            ],
          },
        },
      };
    };
    renderPage();
    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'base');
    await user.type(screen.getByRole('textbox', { name: '名称' }), '主卡');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    const sort = screen.getByLabelText('排序');
    expect(sort).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('subset-sort-error')).toHaveTextContent('内容超出长度限制');
    expect(screen.queryByText(/sortOrder/)).not.toBeInTheDocument();
    expect(screen.queryByText('保存失败，请重试')).not.toBeInTheDocument();
  });

  it('shows a server kind error on the kind control', async () => {
    const user = userEvent.setup();
    subsetCreate.current = async () => {
      throw {
        message: '填写的内容不符合要求，请修改后再试',
        data: {
          code: 'BAD_REQUEST',
          appCode: 'VALIDATION',
          zodError: {
            issues: [{ code: 'invalid_value', path: ['kind'], message: 'invalid_value' }],
          },
        },
      };
    };
    renderPage();
    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'base');
    await user.type(screen.getByRole('textbox', { name: '名称' }), '主卡');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(screen.getByRole('radio', { name: '基础' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('radio', { name: '基础' })).toHaveAttribute(
      'aria-describedby',
      'subset-kind-error',
    );
    expect(document.getElementById('subset-kind-error')).toHaveTextContent('这个选项不可用');
    expect(screen.queryByText(/^kind:/)).not.toBeInTheDocument();
  });

  it('names the description and the 5000-character limit on the form alert', async () => {
    const user = userEvent.setup();
    subsetCreate.current = async () => {
      throw {
        message: '填写的内容不符合要求，请修改后再试',
        data: {
          code: 'BAD_REQUEST',
          appCode: 'VALIDATION',
          zodError: {
            issues: [
              {
                code: 'too_big',
                maximum: 5000,
                path: ['description'],
                message: 'description_too_long',
              },
            ],
          },
        },
      };
    };
    renderPage();
    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'base');
    await user.type(screen.getByRole('textbox', { name: '名称' }), '主卡');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(screen.getByRole('alert')).toHaveTextContent('简介最多 5000 个字符');
    expect(screen.queryByText('内容超出长度限制')).not.toBeInTheDocument();
    expect(screen.queryByText('description_too_long')).not.toBeInTheDocument();
    expect(screen.queryByText(/description:/)).not.toBeInTheDocument();
    expect(document.getElementById('subset-name-error')).not.toBeInTheDocument();
  });
});
