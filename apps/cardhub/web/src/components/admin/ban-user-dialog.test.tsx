import '../../pages/admin/test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, type ComponentProps } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../../stores/root-store';
import { resetUsersMock, usersMock } from '../../pages/admin/users-trpc-mock';
import { BanUserDialog } from './ban-user-dialog';

vi.mock('../../lib/trpc', async () => {
  const mod = await import('../../pages/admin/users-trpc-mock');
  return mod.usersTrpcMock;
});

import { AdminUsersPage } from '../../pages/admin/users';

function renderDialog(props: Partial<ComponentProps<typeof BanUserDialog>> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <BanUserDialog
      mode="ban"
      username="alice"
      open
      pending={false}
      alertMessage={null}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, onOpenChange, rerender: view.rerender };
}

beforeEach(() => {
  resetUsersMock();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
});

describe('BanUserDialog', () => {
  it('focuses the reason field and does not submit a blank reason', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    const reason = screen.getByRole('textbox', { name: '封禁原因（必填）' });
    expect(reason).toHaveFocus();
    expect(reason).toHaveAttribute('autocomplete', 'off');
    await user.click(screen.getByRole('button', { name: '封禁' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('请填写原因')).toBeInTheDocument();
    expect(reason).toHaveFocus();
  });

  it('keeps the dialog open when Escape is pressed while busy', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ pending: true });
    expect(screen.getByRole('button', { name: '正在封禁…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('uses the default button style for unban', () => {
    renderDialog({ mode: 'unban' });
    const action = screen.getByRole('button', { name: '解封' });
    expect(action).not.toHaveClass('bg-red-600');
  });

  it('keeps CANNOT_BAN_ADMIN inside the dialog and treats ALREADY_BANNED as success', async () => {
    const user = userEvent.setup();
    const alice = {
      id: 'user-1',
      username: 'alice',
      email: 'alice@cardhub.test',
      role: 'user',
      createdAt: '2026-03-02T00:00:00.000Z',
      bannedAt: null,
      bannedBy: null,
      counts: { topics: 0, replies: 0, comments: 0, listings: 0 },
    };
    const second = { ...alice, id: 'user-2', username: 'beth', email: 'beth@cardhub.test' };
    usersMock.data = {
      pages: [
        { items: [alice], total: 2, nextCursor: 'user-1' },
        { items: [second], total: 2, nextCursor: null },
      ],
      pageParams: [null, 'user-1'],
    };
    usersMock.ban.mockRejectedValueOnce({
      message: 'internal',
      data: { code: 'FORBIDDEN', appCode: 'CANNOT_BAN_ADMIN' },
    });
    render(
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: '封禁 @alice' }));
    await user.type(screen.getByRole('textbox', { name: '封禁原因（必填）' }), '原因');
    await user.click(screen.getByRole('button', { name: '封禁' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('不能封禁管理员');
    expect(screen.getByRole('button', { name: '封禁' })).toHaveFocus();

    usersMock.ban.mockRejectedValueOnce({
      message: 'internal',
      data: {
        code: 'CONFLICT',
        appCode: 'ALREADY_BANNED',
        subject: {
          ...alice,
          bannedAt: '2026-10-27T02:00:00.000Z',
          bannedBy: { username: 'other' },
        },
      },
    });
    await user.click(screen.getByRole('button', { name: '封禁' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解封 @alice' })).toBeInTheDocument();
    expect(screen.getByText('@beth')).toBeInTheDocument();
    expect(screen.getByText('已封禁 @alice，对方的所有设备已退出登录。')).toHaveFocus();
  });

  it('treats NOT_BANNED as success for unban', async () => {
    const user = userEvent.setup();
    const alice = {
      id: 'user-1',
      username: 'alice',
      email: 'alice@cardhub.test',
      role: 'user',
      createdAt: '2026-03-02T00:00:00.000Z',
      bannedAt: '2026-10-01T00:00:00.000Z',
      bannedBy: { username: 'admin' },
      counts: { topics: 0, replies: 0, comments: 0, listings: 0 },
    };
    usersMock.data = {
      pages: [{ items: [alice], total: 1, nextCursor: null }],
      pageParams: [null],
    };
    usersMock.unban.mockRejectedValueOnce({
      message: 'internal',
      data: {
        code: 'CONFLICT',
        appCode: 'NOT_BANNED',
        subject: { ...alice, bannedAt: null, bannedBy: null },
      },
    });
    render(
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: '解封 @alice' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: '解封' })).not.toHaveClass('bg-red-600');
    await user.type(within(dialog).getByRole('textbox'), '恢复');
    await user.click(within(dialog).getByRole('button', { name: '解封' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '封禁 @alice' })).toBeInTheDocument();
    expect(screen.getByText('已解封 @alice')).toHaveFocus();
  });

  it('keeps the unban action until the dialog content unmounts', async () => {
    const restoreAnimation = holdDialogExitAnimation();
    try {
      const onOpenChange = vi.fn();
      const onConfirm = vi.fn();
      const view = render(
        <StrictMode>
          <BanUserDialog
            mode="unban"
            username="alice"
            open
            pending={false}
            alertMessage={null}
            onOpenChange={onOpenChange}
            onConfirm={onConfirm}
          />
        </StrictMode>,
      );
      expect(screen.getByRole('heading', { name: '解封 @alice？' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '解封' })).not.toHaveClass('bg-red-600');

      view.rerender(
        <StrictMode>
          <BanUserDialog
            mode="ban"
            username=""
            open={false}
            pending={false}
            alertMessage={null}
            onOpenChange={onOpenChange}
            onConfirm={onConfirm}
          />
        </StrictMode>,
      );

      const closing = screen.getByRole('alertdialog');
      expect(within(closing).getByRole('heading', { name: '解封 @alice？' })).toBeInTheDocument();
      expect(within(closing).getByRole('button', { name: '解封' })).not.toHaveClass('bg-red-600');
      expect(within(closing).queryByRole('button', { name: '封禁' })).not.toBeInTheDocument();
      expect(within(closing).queryByText('封禁 @？')).not.toBeInTheDocument();

      const ended = new Event('animationend', { bubbles: true });
      Object.defineProperty(ended, 'animationName', { value: 'dialog-out' });
      await act(async () => {
        closing.dispatchEvent(ended);
      });
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

      view.rerender(
        <StrictMode>
          <BanUserDialog
            mode="ban"
            username="bob"
            open
            pending={false}
            alertMessage={null}
            onOpenChange={onOpenChange}
            onConfirm={onConfirm}
          />
        </StrictMode>,
      );
      expect(screen.getByRole('heading', { name: '封禁 @bob？' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '封禁' })).toHaveClass('bg-red-600');
    } finally {
      restoreAnimation();
    }
  });
});

function holdDialogExitAnimation() {
  const original = window.getComputedStyle.bind(window);
  const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    if (element instanceof Element && element.getAttribute('role') === 'alertdialog') {
      return {
        get animationName() {
          return element.getAttribute('data-state') === 'closed' ? 'dialog-out' : 'dialog-in';
        },
        display: 'block',
      } as CSSStyleDeclaration;
    }
    return original(element);
  });
  return () => spy.mockRestore();
}
