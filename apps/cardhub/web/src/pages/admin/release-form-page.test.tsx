import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { rootStore } from '../../stores/root-store';
import { EditReleasePage, NewReleasePage } from './release-form-page';

const create = vi.fn();

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      admin: {
        releases: {
          list: { invalidate: vi.fn(), fetch: vi.fn() },
          getById: { invalidate: vi.fn() },
        },
      },
      releases: { list: { invalidate: vi.fn() } },
    }),
    categories: {
      list: {
        useQuery: () => ({
          data: { items: [{ id: 'cat-1', slug: 'deck', name: '构筑对战' }] },
          isLoading: false,
          isFetching: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
    admin: {
      releases: {
        getById: {
          useQuery: (input?: { id?: string }) => {
            const id = input?.id ?? '';
            const uuid =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
            if (id.length > 0 && !uuid) {
              return {
                data: undefined,
                isLoading: false,
                isPending: false,
                isFetching: false,
                isError: true,
                error: { message: 'Bad request', data: { code: 'BAD_REQUEST' } },
                errorUpdateCount: 1,
                dataUpdatedAt: 0,
                refetch: vi.fn(),
              };
            }
            return {
              data: undefined,
              isLoading: false,
              isPending: false,
              isFetching: false,
              isError: false,
              error: null,
              errorUpdateCount: 0,
              dataUpdatedAt: 0,
              refetch: vi.fn(),
            };
          },
        },
        create: { useMutation: () => ({ mutateAsync: create, isPending: false }) },
        update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      },
    },
    search: {
      global: {
        useQuery: () => ({
          data: { series: [], cards: [] },
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: true,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = (await vi.importActual('@tanstack/react-query')) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: () => ({
      data: undefined,
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      errorUpdateCount: 0,
      dataUpdatedAt: 0,
      refetch: vi.fn(),
    }),
  };
});

function renderEdit(id: string) {
  const router = createMemoryRouter(
    [{ path: '/admin/releases/:id/edit', element: <EditReleasePage /> }],
    { initialEntries: [`/admin/releases/${id}/edit`] },
  );
  return render(<RouterProvider router={router} />);
}

function renderNew() {
  const router = createMemoryRouter(
    [
      { path: '/admin/releases/new', element: <NewReleasePage /> },
      { path: '/admin/releases', element: <h1>列表</h1> },
    ],
    { initialEntries: ['/admin/releases/new'] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  create.mockReset();
  create.mockResolvedValue({ id: 'new-id' });
});

describe('release edit load', () => {
  it('shows the existing admin-only notice to a non-admin', () => {
    rootStore.session.signIn('token', { id: 'u1', username: 'ada', role: 'user' });
    renderEdit('11111111-1111-4111-8111-111111111111');
    expect(screen.getByRole('heading', { name: '编辑条目' })).toBeInTheDocument();
    expect(screen.getByText('仅管理员可以管理内容')).toBeInTheDocument();
    expect(screen.queryByLabelText('标题')).not.toBeInTheDocument();
  });

  it('shows the missing release state for a non-uuid id', () => {
    renderEdit('not-a-uuid');
    expect(screen.getByText('发售条目不存在')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('release form validation', () => {
  it('normalizes a pasted date and shows §7 sentences under the fields', async () => {
    const user = userEvent.setup();
    renderNew();
    const date = screen.getByLabelText('发售日期');
    await user.type(date, '2026/11/06');
    fireEvent.blur(date);
    expect(date).toHaveValue('2026-11-06');

    await user.clear(date);
    await user.type(date, '2026/02/31');
    await user.type(screen.getByLabelText('来源链接'), 'http://example.com/a');
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    expect(screen.getByText('标题不能为空')).toBeInTheDocument();
    expect(screen.getByText('日期必须是有效的 YYYY-MM-DD')).toBeInTheDocument();
    expect(screen.getByText('来源链接必须以 https:// 开头')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('invalid_date');
    expect(document.body).not.toHaveTextContent('source_url');
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByLabelText('标题')).toHaveFocus();
  });

  it('shows the English sentences and a server region error under the field', async () => {
    const user = userEvent.setup();
    rootStore.locale.setLocale('en-US');
    create.mockRejectedValue({
      message: 'Some fields need to be changed before you can continue.',
      data: {
        code: 'BAD_REQUEST',
        appCode: 'VALIDATION',
        zodError: { fieldErrors: { region: ['release_region'], releaseDate: ['invalid_date'] } },
      },
    });
    renderNew();
    await user.type(screen.getByLabelText('Title'), 'Spring pack');
    await user.type(screen.getByLabelText('Release date'), '2026-11-06');
    await user.type(screen.getByLabelText('Source link'), 'https://example.com/a');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Choose China mainland, Japan, or Global.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid date as YYYY-MM-DD.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('release_region');
    expect(document.body).not.toHaveTextContent('invalid_date');
  });

  it('switches the date hint when only the month is known', async () => {
    const user = userEvent.setup();
    renderNew();
    expect(screen.getByText('格式 2026-11-06')).toBeInTheDocument();
    await user.click(screen.getByLabelText('只知道月份'));
    expect(screen.getByText('格式 2026-11')).toBeInTheDocument();
    const date = screen.getByLabelText('发售日期');
    await user.type(date, '2026.11.06');
    fireEvent.blur(date);
    expect(date).toHaveValue('2026-11');
  });
});
