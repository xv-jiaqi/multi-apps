import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../../stores/root-store';
import { resetUsersMock, usersMock } from './users-trpc-mock';
import type { AdminUserRow } from './users';

vi.mock('../../lib/trpc', async () => {
  const mod = await import('./users-trpc-mock');
  return mod.usersTrpcMock;
});

import { AdminUsersPage } from './users';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.search}</div>;
}

function renderPage(entry = '/admin/users') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/admin/users"
          element={
            <>
              <AdminUsersPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function userRow(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: 'user-1',
    username: 'alice',
    email: 'alice@cardhub.test',
    role: 'user',
    createdAt: '2026-03-02T00:00:00.000Z',
    bannedAt: null,
    bannedBy: null,
    counts: { topics: 1, replies: 2, comments: 3, listings: 4 },
    ...overrides,
  };
}

function setRows(items: AdminUserRow[], total = items.length) {
  usersMock.data = {
    pages: [{ items, total, nextCursor: null }],
    pageParams: [null],
  };
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

describe('AdminUsersPage access', () => {
  it('asks anonymous visitors to sign in and does not list users', () => {
    rootStore.session.signOut();
    renderPage();
    expect(screen.getByRole('link', { name: '请先登录管理员账号' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(usersMock.inputs).toHaveLength(0);
  });

  it('tells signed-in non-admins they cannot manage content', () => {
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    renderPage();
    expect(screen.getByText('仅管理员可以管理内容')).toBeInTheDocument();
    expect(usersMock.inputs).toHaveLength(0);
  });

  it('switches to the admin-only view when the API returns FORBIDDEN', async () => {
    usersMock.isError = true;
    usersMock.error = { message: 'Prisma secret', data: { code: 'FORBIDDEN' } };
    renderPage();
    expect(await screen.findByText('仅管理员可以管理内容')).toBeInTheDocument();
    expect(screen.queryByText('Prisma secret')).not.toBeInTheDocument();
    expect(screen.queryByText('FORBIDDEN')).not.toBeInTheDocument();
  });
});

describe('AdminUsersPage list', () => {
  it('loads from the URL, debounces search, and syncs status', async () => {
    const user = userEvent.setup();
    setRows([userRow()]);
    renderPage('/admin/users?q=ada&status=banned');
    expect(usersMock.inputs[0]).toEqual({ limit: 20, q: 'ada', status: 'banned' });
    expect(screen.getByRole('searchbox', { name: '按用户名或邮箱搜索' })).toHaveValue('ada');
    expect(screen.getByRole('radio', { name: '已封禁' })).toBeChecked();

    await user.clear(screen.getByRole('searchbox', { name: '按用户名或邮箱搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '按用户名或邮箱搜索' }), 'bob');
    await waitFor(() => {
      expect(usersMock.inputs.at(-1)).toEqual({ limit: 20, q: 'bob', status: 'banned' });
    });
    expect(screen.getByTestId('loc')).toHaveTextContent('q=bob');
    expect(screen.getByTestId('loc')).toHaveTextContent('status=banned');

    await user.click(screen.getByRole('radio', { name: '正常' }));
    await waitFor(() => {
      expect(usersMock.inputs.at(-1)).toEqual({ limit: 20, q: 'bob', status: 'active' });
    });
  });

  it('pluralizes the total and renders both status chips without a history button', () => {
    setRows([
      userRow(),
      userRow({
        id: 'admin',
        username: 'admin',
        email: 'admin@cardhub.test',
        role: 'admin',
      }),
      userRow({
        id: 'banned-1',
        username: 'cara',
        email: 'cara@cardhub.test',
        role: 'user',
        bannedAt: '2026-04-01T08:30:00.000Z',
        bannedBy: { username: 'mod' },
      }),
    ]);
    renderPage();
    expect(screen.getByText('共 3 位用户')).toBeInTheDocument();
    expect(screen.getAllByText('正常').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已封禁').length).toBeGreaterThan(1);
    expect(screen.getByText('管理员')).toBeInTheDocument();
    expect(screen.getByText(/@mod/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '封禁 @alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解封 @cara' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '封禁 @admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /记录/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /操作记录/ })).not.toBeInTheDocument();
    expect(screen.getAllByTitle('话题 1 · 回帖 2 · 评论 3 · 交易意向 4')[0]).toHaveTextContent(
      '10',
    );

    act(() => {
      rootStore.locale.setLocale('en-US');
    });
    expect(screen.getByText('3 users')).toBeInTheDocument();
  });

  it('shows five skeleton rows while loading', () => {
    usersMock.isLoading = true;
    renderPage();
    const table = screen.getByRole('table', { name: '用户列表' });
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(within(table).getAllByRole('row')).toHaveLength(6);
  });

  it('returns focus to search after clearing an empty filter', async () => {
    const user = userEvent.setup();
    setRows([]);
    renderPage('/admin/users?q=missing');
    await user.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('searchbox', { name: '按用户名或邮箱搜索' })).toHaveFocus();
    expect(screen.getByTestId('loc').textContent).toBe('');
  });

  it('clears status from the control and the URL together', async () => {
    const user = userEvent.setup();
    setRows([]);
    renderPage('/admin/users?q=ada&status=banned');
    expect(screen.getByRole('radio', { name: '已封禁' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: '清除筛选' }));

    expect(screen.getByRole('radio', { name: '全部' })).toBeChecked();
    expect(screen.getByRole('searchbox', { name: '按用户名或邮箱搜索' })).toHaveValue('');
    const search = screen.getByTestId('loc').textContent ?? '';
    expect(search).not.toContain('status=');
    expect(search).not.toContain('q=');
    expect(usersMock.inputs.at(-1)).toEqual({ limit: 20 });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(screen.getByRole('radio', { name: '全部' })).toBeChecked();
    expect(screen.getByTestId('loc').textContent ?? '').not.toContain('status=');
  });

  it('shows a retry box without the server message', () => {
    usersMock.isError = true;
    usersMock.error = { message: 'PrismaClientKnownRequestError LEAK' };
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Prisma');
    expect(screen.getByRole('alert')).not.toHaveTextContent('LEAK');
  });

  it('keeps loaded rows and focuses the load-more button after another page', async () => {
    const user = userEvent.setup();
    const first = userRow();
    const second = userRow({ id: 'user-2', username: 'beth', email: 'beth@cardhub.test' });
    setRows([first]);
    usersMock.hasNextPage = true;
    usersMock.data.pages[0]!.nextCursor = 'user-1';
    usersMock.fetchNextPage.mockImplementation(async () => {
      usersMock.data = {
        pages: [
          { items: [first], total: 2, nextCursor: 'user-1' },
          { items: [second], total: 2, nextCursor: null },
        ],
        pageParams: [null, 'user-1'],
      };
      usersMock.hasNextPage = true;
      return { isError: false, hasNextPage: true, data: usersMock.data };
    });
    const view = renderPage();
    await user.click(screen.getByRole('button', { name: '加载更多' }));
    expect(screen.getByRole('button', { name: '加载更多' })).toHaveFocus();
    view.rerender(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route
            path="/admin/users"
            element={
              <>
                <AdminUsersPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('rowheader', { name: /@beth/ })).toBeInTheDocument();
  });

  it('replaces load-more with a retry when the next page fails', () => {
    setRows([userRow()]);
    usersMock.isFetchNextPageError = true;
    usersMock.hasNextPage = true;
    renderPage();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });
});

describe('AdminUsersPage dialog focus return', () => {
  it.each([
    ['mouse', 'cancel'],
    ['mouse', 'escape'],
    ['keyboard', 'cancel'],
    ['keyboard', 'escape'],
  ] as const)('returns focus to the row button after %s open and %s close', async (openWith, closeWith) => {
    const user = userEvent.setup();
    setRows([
      userRow(),
      userRow({
        id: 'banned-1',
        username: 'cara',
        email: 'cara@cardhub.test',
        bannedAt: '2026-04-01T08:30:00.000Z',
        bannedBy: { username: 'mod' },
      }),
    ]);
    renderPage();
    const trigger = screen.getByRole('button', { name: '封禁 @alice' });

    if (openWith === 'mouse') {
      await user.click(trigger);
    } else {
      trigger.focus();
      await user.keyboard('{Enter}');
    }
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    if (closeWith === 'cancel') {
      await user.click(screen.getByRole('button', { name: '取消' }));
    } else {
      await user.keyboard('{Escape}');
    }

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '封禁 @alice' })).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('AdminUsersPage ban flow', () => {
  it('updates the row in place, keeps later pages, and focuses the notice', async () => {
    const user = userEvent.setup();
    const first = userRow();
    const second = userRow({ id: 'user-2', username: 'beth', email: 'beth@cardhub.test' });
    usersMock.data = {
      pages: [
        { items: [first], total: 2, nextCursor: 'user-1' },
        { items: [second], total: 2, nextCursor: null },
      ],
      pageParams: [null, 'user-1'],
    };
    usersMock.ban.mockImplementation(async () => ({
      ...first,
      bannedAt: '2026-10-27T01:00:00.000Z',
      bannedBy: { username: 'admin' },
    }));
    renderPage();
    await user.click(screen.getByRole('button', { name: '封禁 @alice' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('textbox')).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: '封禁' }));
    expect(usersMock.ban).not.toHaveBeenCalled();
    expect(within(dialog).getByText('请填写原因')).toBeInTheDocument();

    await user.type(within(dialog).getByRole('textbox'), '  骚扰  ');
    await user.click(within(dialog).getByRole('button', { name: '封禁' }));
    expect(usersMock.ban).toHaveBeenCalledWith({ userId: 'user-1', reason: '骚扰' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解封 @alice' })).toBeInTheDocument();
    expect(screen.getByText('@beth')).toBeInTheDocument();
    const notice = screen.getByText('已封禁 @alice，对方的所有设备已退出登录。');
    expect(notice).toHaveFocus();
    expect(screen.getByText('共 2 位用户')).toBeInTheDocument();
  });
});
