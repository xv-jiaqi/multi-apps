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

function renderAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SiteHeader />
    </MemoryRouter>,
  );
}

describe('SiteHeader account menu (CH-218 §5)', () => {
  it('shows only an avatar, and opens an admin section with separator, heading and 5 items', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
    renderAt();

    expect(screen.queryByText('@admin')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '管理' })).not.toBeInTheDocument();
    const avatar = screen.getByRole('button', { name: '@admin 的个人中心' });
    expect(avatar).toHaveTextContent('a');
    expect(avatar).toHaveClass('size-11');
    expect(avatar).toHaveAttribute('aria-controls', 'account-menu');
    expect(avatar).toHaveAttribute('aria-expanded', 'false');
    expect(avatar).not.toHaveClass('ring-brand-500');

    await user.click(avatar);
    expect(avatar).toHaveAttribute('aria-expanded', 'true');
    const menu = document.getElementById('account-menu');
    if (!(menu instanceof HTMLElement)) throw new Error('头像菜单没有打开');
    const items = [...menu.children];
    expect(items.every((item) => item.tagName === 'LI' && !item.hasAttribute('role'))).toBe(true);
    const divider = items[2];
    expect(divider).toHaveAttribute('aria-hidden', 'true');
    expect(divider).toHaveClass('my-1', 'border-t', 'border-neutral-200');
    expect(divider).toBeEmptyDOMElement();
    expect(within(menu).getByText('管理')).toHaveClass('text-neutral-600');
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['个人中心', '/me'],
      ['通知', '/notifications'],
      ['内容管理', '/admin/catalog'],
      ['发售条目', '/admin/releases'],
      ['用户管理', '/admin/users'],
      ['举报队列', '/reports'],
      ['操作审计', '/admin/audit'],
    ]);

    await user.keyboard('{Escape}');
    expect(avatar).toHaveAttribute('aria-expanded', 'false');
    expect(avatar).toHaveFocus();
    expect(document.getElementById('account-menu')).toBeNull();
  });

  it('gives regular users no admin section and closes on an outside click', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    renderAt();
    const avatar = screen.getByRole('button', { name: '@ada 的个人中心' });
    await user.click(avatar);
    const menu = document.getElementById('account-menu') as HTMLElement;
    expect(menu.querySelector('li[aria-hidden="true"]')).toBeNull();
    expect(within(menu).getAllByRole('link')).toHaveLength(2);
    await user.click(document.body);
    expect(avatar).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the current page and rings the avatar inside the account area', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
    renderAt('/reports');
    const avatar = screen.getByRole('button', { name: '@admin 的个人中心' });
    expect(avatar).toHaveClass('ring-2', 'ring-brand-500');
    await user.click(avatar);
    expect(screen.getByRole('link', { name: '举报队列' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('SiteHeader collapsing row (CH-218 §3 §4 §6)', () => {
  it('keeps one nowrap row, xl-only desktop nav with 6 links and a 44px search icon', () => {
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    renderAt();
    const nav = screen.getAllByRole('navigation')[0] as HTMLElement;
    expect(nav).toHaveClass('hidden', 'xl:flex');
    expect(nav.parentElement).toHaveClass('flex-nowrap', 'h-16');
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['首页', '分类', '系列', '发售日历', '论坛', '交易']);
    for (const link of within(nav).getAllByRole('link')) {
      expect(link).toHaveClass('whitespace-nowrap', 'shrink-0');
    }
    const search = screen.getByRole('link', { name: '搜索' });
    expect(search).toHaveAttribute('href', '/search');
    expect(search).toHaveClass('size-11', 'lg:hidden');
    expect(screen.getByRole('link', { name: '首页' })).toHaveClass('text-neutral-900');
    expect(screen.getByRole('link', { name: '分类' })).toHaveClass('text-neutral-600');
  });

  it('hamburger lists the main nav then locale and logout, and Esc returns focus', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
    renderAt('/series');
    const toggle = screen.getByRole('button', { name: '打开导航菜单' });
    expect(toggle).toHaveClass('size-11', 'xl:hidden');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('关闭导航菜单');
    const drawer = document.getElementById('mobile-nav');
    if (!(drawer instanceof HTMLElement)) throw new Error('汉堡菜单没有打开');
    expect(drawer).toHaveClass('bg-card');
    expect(drawer).not.toHaveClass('backdrop-blur');
    expect(
      within(drawer)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['首页', '分类', '系列', '发售日历', '论坛', '交易']);
    expect(within(drawer).getByRole('link', { name: '系列' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(drawer).queryByRole('link', { name: '用户管理' })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('searchbox')).not.toBeInTheDocument();
    expect(
      within(drawer)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['EN', '退出登录']);

    await user.keyboard('{Escape}');
    expect(document.getElementById('mobile-nav')).toBeNull();
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the hamburger after an item is chosen', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole('button', { name: '打开导航菜单' }));
    const drawer = document.getElementById('mobile-nav') as HTMLElement;
    expect(
      within(drawer)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['首页', '分类', '系列', '发售日历', '论坛', '交易', '注册']);
    await user.click(within(drawer).getByRole('link', { name: '论坛' }));
    expect(document.getElementById('mobile-nav')).toBeNull();
  });
});

describe('SiteHeader', () => {
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

  it('keeps the bell off the header until someone is signed in', () => {
    render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: '通知' })).not.toBeInTheDocument();
    expect(unreadQuery).not.toHaveBeenCalled();
  });

  it('places the bell before the avatar and shows the unread count without a live region', () => {
    unreadState.data = { count: 3 };
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    renderAt();

    const bell = screen.getByRole('link', { name: '通知，3 条未读' });
    expect(bell).toHaveClass('size-11');
    expect(bell.nextElementSibling?.querySelector('button')).toHaveAccessibleName(
      '@ada 的个人中心',
    );
    expect(bell).toHaveAttribute('href', '/notifications');
    expect(bell.querySelector('[aria-hidden="true"] + [aria-hidden="true"]')).toHaveTextContent(
      '3',
    );
    expect(bell.closest('[aria-live]')).toBeNull();
    expect(unreadQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
      }),
    );
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
    const badge = bell?.querySelector('[aria-hidden="true"] + [aria-hidden="true"]');
    expect(badge).toHaveClass(
      'absolute',
      '-top-1',
      '-right-1',
      'h-4',
      'min-w-4',
      'leading-4',
      'bg-brand-600',
      'ring-2',
      'ring-card',
    );
    expect(badge).not.toHaveClass('h-5', 'min-w-5', '-top-0.5');

    await user.click(screen.getByRole('button', { name: '退出登录' }));
    expect(clearNotificationCache).toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /通知/ })).not.toBeInTheDocument();
  });

  it('CH-226 26-7: signing out from the header deletes every forum draft in this tab', async () => {
    const user = userEvent.setup();
    window.sessionStorage.clear();
    window.sessionStorage.setItem('cardhub:draft:forum:new', '{}');
    window.sessionStorage.setItem('cardhub:draft:forum:edit:t1', '{}');
    window.sessionStorage.setItem('cardhub:draft:forum:reply:t1', '{}');
    window.sessionStorage.setItem('cardhub:legacyPasswordLater', '1');
    rootStore.session.signIn('token', { id: 'user', username: 'ada', role: 'user' });
    renderAt('/forum');

    await user.click(screen.getByRole('button', { name: '退出登录' }));

    expect(Object.keys(window.sessionStorage)).toEqual(['cardhub:legacyPasswordLater']);
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
