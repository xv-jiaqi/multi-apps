import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
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
    expect(screen.getByRole('link', { name: '举报队列' })).toHaveAttribute('href', '/reports');

    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
    expect(screen.queryByRole('link', { name: '举报队列' })).not.toBeInTheDocument();
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
