import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../../stores/root-store';
import { resetUsersMock, usersMock } from './users-trpc-mock';
import type { AdminUserRow } from './users';
import '../../styles/globals.css';

declare module 'vitest/browser' {
  interface BrowserCommands {
    setViewport: (width: number, height: number) => Promise<void>;
  }
}

vi.mock('../../lib/trpc', async () => {
  const mod = await import('./users-trpc-mock');
  return mod.usersTrpcMock;
});

import { AdminUsersPage } from './users';

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <Routes>
        <Route path="/admin/users" element={<AdminUsersPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function scroller() {
  const table = screen.getByRole('table', { name: '用户列表' });
  const parent = table.parentElement;
  if (!parent) throw new Error('missing scroller');
  return parent;
}

function box(node: Element) {
  const rect = node.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
}

beforeEach(async () => {
  resetUsersMock();
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  await commands.setViewport(375, 900);
});

afterEach(() => {
  cleanup();
});

describe('users table username column at 375', () => {
  it('keeps the username visible after scrolling and does not reset scrollLeft on focus', async () => {
    usersMock.data = {
      pages: [{ items: [userRow()], total: 1, nextCursor: null }],
      pageParams: [null],
    };
    renderPage();
    const scroll = scroller();
    const name = screen.getByRole('rowheader', { name: /@alice/ });
    scroll.scrollLeft = scroll.scrollWidth;
    expect(scroll.scrollLeft).toBeGreaterThan(0);

    const scrolled = scroll.scrollLeft;
    const nameBox = box(name);
    const scrollBox = box(scroll);
    expect(Math.abs(nameBox.left - scrollBox.left)).toBeLessThan(2);
    const style = getComputedStyle(name);
    expect(style.position).toBe('sticky');
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.backgroundColor).not.toBe('transparent');
    expect(Number.parseFloat(style.borderRightWidth)).toBeGreaterThan(0);

    const button = screen.getByRole('button', { name: '封禁 @alice' });
    button.focus();
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    expect(scroll.scrollLeft).toBeGreaterThanOrEqual(scrolled - 1);

    const buttonOffset = button.offsetLeft;
    scroll.scrollLeft = Math.max(0, buttonOffset - 8);
    button.focus();
    const focused = box(button);
    const sticky = box(name);
    expect(focused.left).toBeGreaterThanOrEqual(sticky.right - 1);
    expect(scroll.scrollLeft).not.toBe(0);
  });

  it('wraps a long username inside the sticky column and drops the admin chip to the next line', () => {
    const longName = 'u'.repeat(40);
    usersMock.data = {
      pages: [
        {
          items: [userRow({ id: 'long', username: longName, role: 'admin' })],
          total: 1,
          nextCursor: null,
        },
      ],
      pageParams: [null],
    };
    renderPage();
    const row = screen.getByRole('rowheader', { name: new RegExp(longName) });
    const name = within(row).getByText(`@${longName}`);
    const chip = within(row).getByText('管理员');
    expect(box(row).width).toBeLessThanOrEqual(128.5);
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth + 1);
    expect(box(chip).top).toBeGreaterThan(box(name).top + 4);
    expect(scroller().scrollWidth).toBeGreaterThan(scroller().clientWidth);
  });

  it('is a normal column at 1440', async () => {
    await commands.setViewport(1440, 900);
    usersMock.data = {
      pages: [{ items: [userRow()], total: 1, nextCursor: null }],
      pageParams: [null],
    };
    renderPage();
    const name = screen.getByRole('rowheader', { name: /@alice/ });
    const style = getComputedStyle(name);
    expect(style.position).toBe('static');
    expect(Number.parseFloat(style.borderRightWidth)).toBe(0);
  });
});
