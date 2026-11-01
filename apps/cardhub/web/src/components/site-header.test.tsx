import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

const unreadQuery = vi.hoisted(() => vi.fn());
const clearNotificationCache = vi.hoisted(() => vi.fn());
const unreadState = vi.hoisted(() => ({ data: undefined as { count: number } | undefined }));

vi.mock('../lib/notification-cache', () => ({
  clearNotificationCache: () => clearNotificationCache(),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
        }),
      },
    },
    notifications: {
      unreadCount: {
        useQuery: (...args: unknown[]) => {
          unreadQuery(...args);
          return { data: unreadState.data, isError: false, isLoading: false };
        },
      },
    },
  },
}));

import { SiteHeader } from './site-header';

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  unreadState.data = undefined;
  unreadQuery.mockClear();
  clearNotificationCache.mockClear();
});

describe('SiteHeader admin navigation', () => {
  it('replaces the reports link with a disclosure for admins', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
    render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>,
    );

    const button = screen.getByRole('button', { name: '管理' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: '举报队列' })).not.toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: '内容管理' })).toHaveAttribute(
      'href',
      '/admin/catalog',
    );
    const menu = document.getElementById('admin-nav');
    expect(menu).not.toBeNull();
    expect(
      within(menu as HTMLElement)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['内容管理', '用户管理', '举报队列', '操作审计']);
    expect(screen.getByRole('link', { name: '操作审计' })).toHaveAttribute('href', '/admin/audit');

    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
    expect(screen.queryByRole('link', { name: '举报队列' })).not.toBeInTheDocument();
  });

  it('names the language button EN，切换到英文 while it shows EN', () => {
    rootStore.locale.setLocale('zh-CN');
    render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: 'EN，切换到英文' });
    expect(button).toHaveTextContent('EN');
    expect(button).toHaveAccessibleName('EN，切换到英文');
  });

  it('names the language button 中, Switch to Chinese while it shows 中', () => {
    rootStore.locale.setLocale('en-US');
    render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: '中, Switch to Chinese' });
    expect(button).toHaveTextContent('中');
    expect(button).toHaveAccessibleName('中, Switch to Chinese');
  });

  it('lists user management in the mobile drawer and hides it from non-admins', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
    render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: '打开导航菜单' }));
    const users = screen.getByRole('link', { name: '用户管理' });
    expect(users).toHaveAttribute('href', '/admin/users');
    expect(users).toHaveClass('pl-6');
    const audit = screen.getByRole('link', { name: '操作审计' });
    expect(audit).toHaveAttribute('href', '/admin/audit');
    expect(audit).toHaveClass('pl-6');
  });

  it('keeps the bell off the header until someone is signed in', () => {
    render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: '通知' })).not.toBeInTheDocument();
    expect(unreadQuery).not.toHaveBeenCalled();
  });

  it('places the bell before the username and shows the unread count without a live region', async () => {
    const user = userEvent.setup();
    unreadState.data = { count: 3 };
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>,
    );

    const bells = screen.getAllByRole('link', { name: '通知，3 条未读' });
    expect(bells.length).toBeGreaterThan(0);
    const desktop = bells.find((bell) => bell.parentElement?.className.includes('md:flex'));
    expect(desktop?.nextElementSibling).toHaveTextContent('@ada');
    expect(desktop).toHaveAttribute('href', '/notifications');
    expect(desktop?.querySelector('[aria-hidden="true"] + [aria-hidden="true"]')).toHaveTextContent(
      '3',
    );
    expect(desktop?.closest('[aria-live]')).toBeNull();
    expect(unreadQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
      }),
    );

    await user.click(screen.getByRole('button', { name: '打开导航菜单' }));
    const drawer = document.getElementById('mobile-nav');
    if (!(drawer instanceof HTMLElement)) throw new Error('抽屉没有打开');
    const links = within(drawer).getAllByRole('link');
    const meIndex = links.findIndex((link) => link.textContent?.includes('个人中心'));
    expect(links[meIndex + 1]).toHaveTextContent('通知 3');
    expect(links[meIndex + 1]).toHaveAttribute('href', '/notifications');
  });

  it('shows 99+ and clears cached notifications on sign out', async () => {
    const user = userEvent.setup();
    unreadState.data = { count: 100 };
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>,
    );
    const bell = screen.getAllByRole('link', { name: '通知，99 条以上未读' })[0];
    expect(bell).toBeDefined();
    expect(bell?.textContent).toContain('99+');

    await user.click(screen.getByRole('button', { name: '退出登录' }));
    expect(clearNotificationCache).toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /通知/ })).not.toBeInTheDocument();
  });

  it('hides the admin entry from non-admins', () => {
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: '管理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '举报队列' })).not.toBeInTheDocument();
  });
});
