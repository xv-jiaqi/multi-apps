import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';

const harness = vi.hoisted(() => ({
  invalidate: vi.fn(),
}));

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    useUtils: () => ({
      listings: { invalidate: harness.invalidate },
    }),
    auth: {
      login: {
        useMutation: (options?: {
          onSuccess?: (data: {
            token: string;
            user: { id: string; username: string; role: string };
          }) => void;
        }) => ({
          mutate: () =>
            options?.onSuccess?.({
              token: 'tok',
              user: { id: 'u1', username: 'alice', role: 'user' },
            }),
          isPending: false,
        }),
      },
      register: {
        useMutation: (options?: {
          onSuccess?: (data: {
            token: string;
            user: { id: string; username: string; role: string };
          }) => void;
        }) => ({
          mutate: () =>
            options?.onSuccess?.({
              token: 'tok',
              user: { id: 'u2', username: 'bob', role: 'user' },
            }),
          isPending: false,
        }),
      },
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

function PathProbe() {
  const location = useLocation();
  return <output aria-label="path">{`${location.pathname}${location.search}`}</output>;
}

function FromProbe() {
  const location = useLocation();
  const from =
    location.state && typeof location.state === 'object' && 'from' in location.state
      ? String((location.state as { from?: unknown }).from ?? '')
      : '';
  return <output aria-label="from">{from}</output>;
}

const RETURN_TO = '/trade?kind=SELL&sort=price_asc';

beforeEach(() => {
  harness.invalidate.mockClear();
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
});

describe('login and register listings cache (CH-250)', () => {
  it('invalidates listings and returns to the original trade filters after login', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: RETURN_TO } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/trade" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('邮箱或用户名'), 'alice@example.com');
    await user.type(screen.getByLabelText('密码'), 'password1');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(harness.invalidate).toHaveBeenCalledTimes(1);
    expect(rootStore.session.isAuthenticated).toBe(true);
    expect(screen.getByLabelText('path')).toHaveTextContent(RETURN_TO);
  });

  it('carries the return path from login to register, then invalidates listings', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: RETURN_TO } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/register"
            element={
              <>
                <FromProbe />
                <RegisterPage />
              </>
            }
          />
          <Route path="/trade" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('link', { name: '还没有账户？立即注册' }));
    expect(screen.getByLabelText('from')).toHaveTextContent(RETURN_TO);

    await user.type(screen.getByLabelText('邮箱'), 'bob@example.com');
    await user.type(screen.getByLabelText('用户名'), 'bob');
    await user.type(screen.getByLabelText('密码'), 'password1');
    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(harness.invalidate).toHaveBeenCalledTimes(1);
    expect(rootStore.session.isAuthenticated).toBe(true);
    expect(screen.getByLabelText('path')).toHaveTextContent(RETURN_TO);
  });
});
