import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

describe('English account link accessible name', () => {
  it('starts with the visible @username and has no axe violations', async () => {
    render(
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: `@${username}, my account` });
    expect(link).toHaveTextContent(`@${username}`);
    expect(link).toHaveAccessibleName(`@${username}, my account`);
    expect(link.getAttribute('aria-label') ?? '').toMatch(new RegExp(`^@${username}`));

    const header = link.closest('header');
    expect(header).not.toBeNull();
    const results = await axe.run(header ?? document.body);
    expect(results.violations).toEqual([]);
  });
});
