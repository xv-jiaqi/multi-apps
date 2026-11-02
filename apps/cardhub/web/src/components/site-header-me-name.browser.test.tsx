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

describe('avatar button accessible name', () => {
  it('english 1440 starts with @username and has no axe violations', async () => {
    renderHeader();

    const avatar = screen.getByRole('button', { name: `@${username}, my account` });
    expect(avatar.getAttribute('aria-label') ?? '').toMatch(new RegExp(`^@${username}`));
    expect(screen.queryByText(`@${username}`)).toBeNull();
    const box = avatar.getBoundingClientRect();
    expect([box.width, box.height]).toEqual([44, 44]);
    await expectHeaderHasNoAxeViolations(avatar);
  });

  it('chinese 1440 keeps @username 的个人中心 and has no axe violations', async () => {
    rootStore.locale.setLocale('zh-CN');
    renderHeader();

    const avatar = screen.getByRole('button', { name: `@${username} 的个人中心` });
    await userEvent.click(avatar);
    expect(screen.getByRole('link', { name: '个人中心' })).toHaveAttribute('href', '/me');
    await expectHeaderHasNoAxeViolations(avatar);
  });

  it('375 keeps brand, search, bell, avatar and hamburger on one row without overflow', async () => {
    rootStore.locale.setLocale('zh-CN');
    await commands.setViewport(375, 812);
    renderHeader();

    const toggle = screen.getByRole('button', { name: '打开导航菜单' });
    const avatar = screen.getByRole('button', { name: `@${username} 的个人中心` });
    for (const el of [toggle, avatar, screen.getByRole('link', { name: '搜索' })]) {
      const box = el.getBoundingClientRect();
      expect([box.width, box.height]).toEqual([44, 44]);
    }
    expect(document.documentElement.scrollWidth).toBe(375);
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expectHeaderHasNoAxeViolations(toggle);
  });
});
