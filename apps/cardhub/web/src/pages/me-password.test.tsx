import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { APP_ERROR_CODES } from '@repo/shared';
import { rootStore } from '../stores/root-store';

const passwordHandlers: {
  onSuccess?: (data: { token: string }) => void;
  onError?: (error: {
    message: string;
    data?: {
      code?: string;
      appCode?: string;
      zodError?: { fieldErrors?: Record<string, string[]> };
    };
  }) => void;
} = {};

const signOutHandlers: {
  onSuccess?: () => void;
  onError?: (error: { data?: { code?: string; appCode?: string } }) => void;
} = {};

const { clearActiveQueryClient, mutatePassword } = vi.hoisted(() => ({
  clearActiveQueryClient: vi.fn(),
  mutatePassword: vi.fn(),
}));

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: () => clearActiveQueryClient(),
  trpc: {
    auth: {
      changePassword: {
        useMutation: (options: typeof passwordHandlers) => {
          passwordHandlers.onSuccess = options.onSuccess;
          passwordHandlers.onError = options.onError;
          return {
            mutate: mutatePassword,
            isPending: false,
          };
        },
      },
      signOutAll: {
        useMutation: () => ({
          mutate: (
            _input: unknown,
            options?: { onSuccess?: () => void; onError?: (error: unknown) => void },
          ) => {
            signOutHandlers.onSuccess = options?.onSuccess;
            signOutHandlers.onError = options?.onError as typeof signOutHandlers.onError;
          },
          isPending: false,
        }),
      },
      login: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
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

import { ChangePasswordPage } from './me-password';
import { LoginPage } from './login';
import { SignOutAllDialog } from '../components/sign-out-all-dialog';

function Probe() {
  const location = useLocation();
  return (
    <p data-testid="probe">
      {location.pathname}
      {location.hash}|{JSON.stringify(location.state)}
    </p>
  );
}

function renderPassword() {
  return render(
    <MemoryRouter initialEntries={['/me/password']}>
      <Routes>
        <Route path="/me/password" element={<ChangePasswordPage />} />
        <Route path="/login" element={<Probe />} />
        <Route path="/me" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
  passwordHandlers.onSuccess = undefined;
  passwordHandlers.onError = undefined;
  signOutHandlers.onSuccess = undefined;
  signOutHandlers.onError = undefined;
  clearActiveQueryClient.mockReset();
  mutatePassword.mockReset();
});

describe('ChangePasswordPage', () => {
  it('sends anonymous visitors to login', () => {
    rootStore.session.signOut();
    renderPassword();
    expect(screen.getByTestId('probe')).toHaveTextContent('/login|{"from":"/me/password"}');
  });

  it('checks empty, length, and mismatch before calling the API', async () => {
    const user = userEvent.setup();
    renderPassword();

    await user.click(screen.getByRole('button', { name: '保存密码' }));
    expect(screen.getByText('请填写当前密码')).toBeInTheDocument();
    expect(screen.getByText('请填写新密码')).toBeInTheDocument();
    expect(screen.getByLabelText('当前密码')).toHaveFocus();

    await user.type(screen.getByLabelText('当前密码'), 'old-password');
    await user.type(screen.getByLabelText('新密码'), 'short');
    await user.click(screen.getByRole('button', { name: '保存密码' }));
    expect(screen.getByText('新密码需要 8 到 72 个字符')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('新密码'));
    await user.type(screen.getByLabelText('新密码'), 'a'.repeat(73));
    await user.click(screen.getByRole('button', { name: '保存密码' }));
    expect(screen.getByText('新密码需要 8 到 72 个字符')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('新密码'));
    await user.type(screen.getByLabelText('新密码'), 'new-password');
    await user.type(screen.getByLabelText('确认新密码'), 'other-password');
    await user.click(screen.getByRole('button', { name: '保存密码' }));
    expect(screen.getByText('两次输入的新密码不一致')).toBeInTheDocument();
    expect(mutatePassword).not.toHaveBeenCalled();
  });

  it('toggles each password field independently', async () => {
    const user = userEvent.setup();
    renderPassword();
    const current = screen.getByLabelText('当前密码');
    const toggles = screen.getAllByRole('button', { name: '显示密码' });
    expect(current).toHaveAttribute('type', 'password');
    await user.click(toggles[0]!);
    expect(current).toHaveAttribute('type', 'text');
    expect(toggles[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('新密码')).toHaveAttribute('type', 'password');
  });

  it('maps wrong password, same password, rate limit, and an unmapped English failure', async () => {
    const user = userEvent.setup();
    renderPassword();
    await user.type(screen.getByLabelText('当前密码'), 'old-password');
    await user.type(screen.getByLabelText('新密码'), 'new-password');
    await user.type(screen.getByLabelText('确认新密码'), 'new-password');
    await user.click(screen.getByRole('button', { name: '保存密码' }));

    act(() => {
      passwordHandlers.onError?.({
        message: '当前密码不正确',
        data: { code: 'UNAUTHORIZED', appCode: APP_ERROR_CODES.WRONG_PASSWORD },
      });
    });
    expect(screen.getByText('当前密码不正确')).toBeInTheDocument();
    expect(screen.queryByText('登录已失效，请重新登录')).not.toBeInTheDocument();

    act(() => {
      passwordHandlers.onError?.({
        message: '新密码不能和当前密码相同',
        data: { code: 'BAD_REQUEST', appCode: APP_ERROR_CODES.SAME_PASSWORD },
      });
    });
    expect(screen.getByText('新密码不能和当前密码相同')).toBeInTheDocument();

    act(() => {
      passwordHandlers.onError?.({
        message: 'Too many requests',
        data: { code: 'TOO_MANY_REQUESTS', appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS },
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('操作太频繁，请稍后再试');

    act(() => {
      rootStore.locale.setLocale('en-US');
    });
    await screen.findByRole('button', { name: 'Save password' });
    act(() => {
      passwordHandlers.onError?.({
        message: '出了点问题，请稍后再试',
        data: { code: 'INTERNAL_SERVER_ERROR' },
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't change your password. Try again.",
    );
    expect(screen.queryByText('出了点问题，请稍后再试')).not.toBeInTheDocument();
  });

  it('stores the new token and returns to account security', async () => {
    const user = userEvent.setup();
    renderPassword();
    await user.type(screen.getByLabelText('当前密码'), 'old-password');
    await user.type(screen.getByLabelText('新密码'), 'new-password');
    await user.type(screen.getByLabelText('确认新密码'), 'new-password');
    await user.click(screen.getByRole('button', { name: '保存密码' }));

    act(() => {
      passwordHandlers.onSuccess?.({ token: 'next-token' });
    });
    expect(rootStore.session.token).toBe('next-token');
    expect(screen.getByTestId('probe')).toHaveTextContent(
      '/me#me-security|{"notice":"passwordChanged"}',
    );
  });
});

describe('login session notices', () => {
  it('shows the signed-out and expired notices without the form error style', () => {
    rootStore.session.signOut();
    const { unmount } = render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { notice: 'signedOutAll' } }]}>
        <LoginPage />
      </MemoryRouter>,
    );
    const signedOut = screen.getByRole('status');
    expect(signedOut).toHaveTextContent('已退出所有设备，请重新登录');
    expect(signedOut.className).toContain('bg-emerald-50');
    unmount();

    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { notice: 'sessionExpired' } }]}>
        <LoginPage />
      </MemoryRouter>,
    );
    const expired = screen.getByRole('status');
    expect(expired).toHaveTextContent('登录已失效，请重新登录');
    expect(expired.className).toContain('bg-neutral-50');
    expect(expired.className).not.toContain('bg-red-50');
  });
});

describe('SignOutAllDialog', () => {
  it('keeps focus on cancel, reports failure on the confirm button, and signs out on success', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/me']}>
        <Routes>
          <Route path="/me" element={<SignOutAllDialog />} />
          <Route path="/login" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: '退出所有设备' }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus());

    await user.click(within(dialog).getByRole('button', { name: '退出所有设备' }));
    act(() => {
      signOutHandlers.onError?.({ data: { code: 'INTERNAL_SERVER_ERROR' } });
    });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('操作失败，请重试');
    expect(within(dialog).getByRole('button', { name: '退出所有设备' })).toHaveFocus();

    act(() => {
      signOutHandlers.onSuccess?.();
    });
    expect(rootStore.session.token).toBeNull();
    expect(clearActiveQueryClient).toHaveBeenCalled();
    expect(screen.getByTestId('probe')).toHaveTextContent('/login|{"notice":"signedOutAll"}');
  });
});
