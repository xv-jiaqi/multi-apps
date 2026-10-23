import { useEffect, useState } from 'react';
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

let passwordPending = false;
const passwordPendingListeners = new Set<() => void>();

function setPasswordPending(pending: boolean) {
  passwordPending = pending;
  for (const listener of passwordPendingListeners) listener();
}

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: () => clearActiveQueryClient(),
  trpc: {
    auth: {
      changePassword: {
        useMutation: (options: typeof passwordHandlers) => {
          const [, setVersion] = useState(0);
          useEffect(() => {
            const listener = () => setVersion((version) => version + 1);
            passwordPendingListeners.add(listener);
            return () => {
              passwordPendingListeners.delete(listener);
            };
          }, []);
          passwordHandlers.onSuccess = options.onSuccess;
          passwordHandlers.onError = options.onError;
          return {
            mutate: mutatePassword,
            isPending: passwordPending,
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
import { SessionExpiryWatcher } from '../components/session-expiry-watcher';
import { noteTrpcFailure } from '../lib/session-expiry';

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
      <SessionExpiryWatcher />
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
  passwordPending = false;
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

    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByText('请输入当前密码')).toBeInTheDocument();
    expect(screen.getByText('密码至少 8 位')).toBeInTheDocument();
    expect(screen.getByText('请再输入一次新密码')).toBeInTheDocument();
    expect(screen.getByLabelText('当前密码')).toHaveFocus();

    await user.type(screen.getByLabelText('当前密码'), 'old-password');
    expect(screen.queryByText('请输入当前密码')).not.toBeInTheDocument();
    expect(screen.getByText('密码至少 8 位')).toBeInTheDocument();
    expect(screen.getByText('请再输入一次新密码')).toBeInTheDocument();

    await user.type(screen.getByLabelText('新密码'), 'short');
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByText('密码至少 8 位')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('新密码'));
    await user.type(screen.getByLabelText('新密码'), 'a'.repeat(129));
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByText('密码最长 128 位')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('新密码'));
    await user.type(screen.getByLabelText('新密码'), 'new-password');
    await user.type(screen.getByLabelText('确认新密码'), 'other-password');
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByText('两次输入的新密码不一致')).toBeInTheDocument();
    expect(mutatePassword).not.toHaveBeenCalled();
  });

  it('toggles each password field independently', async () => {
    const user = userEvent.setup();
    renderPassword();
    const current = screen.getByLabelText('当前密码');
    const toggles = screen.getAllByRole('button', { name: '显示当前密码' });
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
    await user.click(screen.getByRole('button', { name: '修改密码' }));

    act(() => {
      const error = {
        message: '当前密码不正确',
        data: { code: 'UNAUTHORIZED', httpStatus: 401, appCode: APP_ERROR_CODES.WRONG_PASSWORD },
      };
      passwordHandlers.onError?.(error);
      noteTrpcFailure(error);
    });
    expect(screen.getByLabelText('当前密码')).toHaveValue('');
    expect(screen.getByLabelText('当前密码')).toHaveFocus();
    expect(screen.getByText('当前密码不正确')).toBeInTheDocument();
    expect(screen.queryByText('UNAUTHORIZED')).not.toBeInTheDocument();
    expect(screen.queryByText('登录已失效，请重新登录')).not.toBeInTheDocument();
    expect(rootStore.session.token).toBe('token');

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
    expect(screen.getByRole('alert')).toHaveTextContent('尝试次数过多，请稍后再试');
    expect(screen.getByRole('button', { name: '修改密码' })).toHaveFocus();

    act(() => {
      rootStore.locale.setLocale('en-US');
    });
    await screen.findByRole('button', { name: 'Change password' });
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

  it('focuses the submit button after rate-limit and network errors once it is enabled', async () => {
    const user = userEvent.setup();
    renderPassword();
    await user.type(screen.getByLabelText('当前密码'), 'old-password');
    await user.type(screen.getByLabelText('新密码'), 'new-password');
    await user.type(screen.getByLabelText('确认新密码'), 'new-password');
    await user.click(screen.getByRole('button', { name: '修改密码' }));

    act(() => {
      setPasswordPending(true);
    });
    const busySubmit = screen.getByRole('button', { name: '正在修改…' });
    expect(busySubmit).toBeDisabled();
    screen.getByLabelText('当前密码').focus();
    expect(document.activeElement).toBe(screen.getByLabelText('当前密码'));

    act(() => {
      passwordHandlers.onError?.({
        message: 'Too many requests',
        data: { code: 'TOO_MANY_REQUESTS', appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS },
      });
    });
    expect(busySubmit).toBeDisabled();
    expect(document.activeElement).not.toBe(busySubmit);

    act(() => {
      setPasswordPending(false);
    });
    const afterRateLimit = screen.getByRole('button', { name: '修改密码' });
    expect(afterRateLimit).toBeEnabled();
    expect(document.activeElement).toBe(afterRateLimit);
    expect(screen.getByRole('alert')).toHaveTextContent('尝试次数过多，请稍后再试');

    act(() => {
      setPasswordPending(true);
    });
    screen.getByLabelText('当前密码').focus();
    act(() => {
      passwordHandlers.onError?.({ message: 'Failed to fetch' });
    });
    expect(screen.getByRole('button', { name: '正在修改…' })).toBeDisabled();
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '正在修改…' }));
    act(() => {
      setPasswordPending(false);
    });
    const afterNetwork = screen.getByRole('button', { name: '修改密码' });
    expect(afterNetwork).toBeEnabled();
    expect(document.activeElement).toBe(afterNetwork);
    expect(screen.getByRole('alert')).toHaveTextContent('修改失败，请重试');
  });

  it('stores the new token and returns to account security', async () => {
    const user = userEvent.setup();
    renderPassword();
    await user.type(screen.getByLabelText('当前密码'), 'old-password');
    await user.type(screen.getByLabelText('新密码'), 'new-password');
    await user.type(screen.getByLabelText('确认新密码'), 'new-password');
    await user.click(screen.getByRole('button', { name: '修改密码' }));

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
    expect(signedOut).toHaveTextContent('已退出所有设备，请重新登录。');
    expect(signedOut).toHaveAttribute('tabIndex', '-1');
    expect(signedOut).toHaveFocus();
    expect(signedOut.className).toContain('bg-emerald-50');
    unmount();

    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/login', state: { from: '/forum/topic', notice: 'sessionExpired' } },
        ]}
      >
        <Routes>
          <Route
            path="/login"
            element={
              <>
                <LoginPage />
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    const expired = screen.getByRole('status');
    expect(expired).toHaveTextContent('登录已失效，请重新登录。');
    expect(expired).toHaveFocus();
    expect(screen.getByTestId('probe')).toHaveTextContent('/login|{"from":"/forum/topic"}');
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
    expect(screen.getByTestId('probe')).toHaveTextContent(
      '/login|{"from":"/me","notice":"signedOutAll"}',
    );
  });
});
