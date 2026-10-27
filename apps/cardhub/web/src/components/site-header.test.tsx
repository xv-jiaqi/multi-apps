import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
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
  },
}));

import { SiteHeader } from './site-header';

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
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
    expect(screen.getByRole('link', { name: '用户管理' })).toHaveAttribute('href', '/admin/users');
    expect(screen.queryByRole('link', { name: '操作审计' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '举报队列' })).toHaveAttribute('href', '/reports');

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
    expect(screen.queryByRole('link', { name: '操作审计' })).not.toBeInTheDocument();
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
