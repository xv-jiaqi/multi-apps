import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { rootStore } from '../../stores/root-store';

const createImpl: { current: (input: unknown) => Promise<unknown> } = {
  current: async (input) => input,
};

vi.mock('../../lib/trpc', () => ({
  trpc: {
    admin: {
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
      admin: { categories: { list: { invalidate: vi.fn() } } },
      categories: { list: { invalidate: vi.fn() } },
    }),
  },
}));

import { NewCategoryPage } from './category-form-page';

function renderNew() {
  const router = createMemoryRouter(
    [
      { path: '/admin/catalog/categories/new', element: <NewCategoryPage /> },
      { path: '/admin/catalog/categories', element: <h1>品类</h1> },
    ],
    { initialEntries: ['/admin/catalog/categories/new'] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  createImpl.current = async (input) => input;
});

describe('category form server validation', () => {
  it('shows a server sort order error under the sort field', async () => {
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
                maximum: 2147483647,
                path: ['sortOrder'],
                message: '填写的内容不符合要求，请修改后再试',
              },
            ],
          },
        },
      };
    };

    renderNew();
    await user.type(screen.getByRole('textbox', { name: 'slug' }), 'deck-builder');
    await user.type(screen.getByRole('textbox', { name: '名称' }), '构筑');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    const sort = screen.getByLabelText('排序');
    expect(sort).toHaveAttribute('aria-invalid', 'true');
    expect(sort).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('category-sort-error'),
    );
    expect(document.getElementById('category-sort-error')).toHaveTextContent('内容超出长度限制');
    expect(screen.queryByText(/sortOrder/)).not.toBeInTheDocument();
  });
});
