import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

declare module 'vitest/browser' {
  interface BrowserCommands {
    setViewport: (width: number, height: number) => Promise<void>;
  }
}

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    auth: {
      changePassword: {
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

function measure() {
  const doc = document.scrollingElement;
  if (!doc) throw new Error('missing scrolling element');
  const overflowing = [...document.querySelectorAll('main button, main input, main label')].filter(
    (el) => el.getBoundingClientRect().right > doc.clientWidth + 1,
  );
  return {
    clientWidth: doc.clientWidth,
    scrollWidth: doc.scrollWidth,
    innerWidth: window.innerWidth,
    overflowing: overflowing.map((el) => el.tagName),
  };
}

beforeEach(async () => {
  rootStore.session.signOut();
  rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
  await commands.setViewport(375, 900);
});

afterEach(() => {
  cleanup();
});

describe('change password at 375', () => {
  it.each([
    ['zh-CN', '修改密码', '显示当前密码'],
    ['en-US', 'Change password', 'Show current password'],
  ] as const)('keeps the form inside the viewport (%s)', async (locale, submit, show) => {
    rootStore.locale.setLocale(locale);
    render(
      <MemoryRouter>
        <ChangePasswordPage />
      </MemoryRouter>,
    );

    const toggle = screen.getAllByRole('button', { name: show })[0];
    expect(toggle).toBeTruthy();
    const box = toggle!.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect(screen.getByRole('button', { name: submit })).toBeEnabled();

    const metrics = measure();
    expect(metrics.innerWidth).toBe(375);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    expect(metrics.overflowing, JSON.stringify(metrics)).toEqual([]);
  });
});
