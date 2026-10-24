import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

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

const username = 'alice';

beforeEach(async () => {
  rootStore.locale.setLocale('en-US');
  rootStore.session.signIn('token', { id: 'user-1', username, role: 'user' });
  await commands.setViewport(1440, 900);
});

afterEach(() => {
  cleanup();
  rootStore.session.signOut();
  rootStore.locale.setLocale('zh-CN');
});

function renderHeader() {
  render(
    <MemoryRouter>
      <SiteHeader />
    </MemoryRouter>,
  );
}

async function expectHeaderHasNoAxeViolations(link: HTMLElement) {
  const header = link.closest('header');
  expect(header).not.toBeNull();
  const results = await axe.run(header ?? document.body);
  expect(results.violations).toEqual([]);
}

describe('account link accessible name', () => {
  it('english 1440 starts with the visible @username and has no axe violations', async () => {
    renderHeader();

    const link = screen.getByRole('link', { name: `@${username}, my account` });
    expect(link).toHaveTextContent(`@${username}`);
    expect(link).toHaveAccessibleName(`@${username}, my account`);
    expect(link.getAttribute('aria-label') ?? '').toMatch(new RegExp(`^@${username}`));
    await expectHeaderHasNoAxeViolations(link);
  });

  it('chinese 1440 keeps @username 的个人中心 and has no axe violations', async () => {
    rootStore.locale.setLocale('zh-CN');
    renderHeader();

    const link = screen.getByRole('link', { name: `@${username} 的个人中心` });
    expect(link).toHaveTextContent(`@${username}`);
    expect(link).toHaveAccessibleName(`@${username} 的个人中心`);
    await expectHeaderHasNoAxeViolations(link);
  });

  it('375 menu name matches the visible text and has no axe violations', async () => {
    rootStore.locale.setLocale('zh-CN');
    await commands.setViewport(375, 812);
    renderHeader();

    await userEvent.click(screen.getByRole('button', { name: '打开导航菜单' }));

    const link = screen.getByRole('link', { name: `个人中心 @${username}` });
    expect(link).toHaveAttribute('href', '/me');
    expect(link).not.toHaveAttribute('aria-label');
    expect(link).toHaveTextContent(`个人中心 @${username}`);
    expect(link).toHaveAccessibleName(`个人中心 @${username}`);
    await expectHeaderHasNoAxeViolations(link);
  });
});
