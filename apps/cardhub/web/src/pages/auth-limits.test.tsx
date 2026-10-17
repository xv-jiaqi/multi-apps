import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

vi.mock('../lib/trpc', () => ({
  trpc: {
    auth: {
      register: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      login: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isFetching: false,
          isError: false,
          isSuccess: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import { LoginPage } from './login';
import { RegisterPage } from './register';

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
});

describe('auth length limits', () => {
  it('shows the shared email length copy instead of the zod default', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('邮箱'), `${'a'.repeat(120)}@example.com`);
    await user.type(screen.getByLabelText('用户名'), 'alice');
    await user.type(screen.getByLabelText('密码'), 'password1');
    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(screen.getByText('邮箱最长 128 个字符')).toBeInTheDocument();
    expect(screen.queryByText(/Too big/)).not.toBeInTheDocument();
  });

  it('shows the shared identifier length copy on login', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('邮箱或用户名'), 'a'.repeat(129));
    await user.type(screen.getByLabelText('密码'), 'password1');
    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(screen.getByText('邮箱或用户名最长 128 个字符')).toBeInTheDocument();
    expect(screen.queryByText(/Too big/)).not.toBeInTheDocument();
  });
});
