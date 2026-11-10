import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { APP_ERROR_CODES } from '@repo/shared';
import { rootStore } from '../stores/root-store';

const clearActiveQueryClient = vi.fn();

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: () => clearActiveQueryClient(),
  trpc: {},
}));

import { SessionExpiryWatcher } from './session-expiry-watcher';
import { noteTrpcFailure, noteTrpcQueryFailure } from '../lib/session-expiry';
import { resetSessionExpiryRedirectForTests } from '../lib/session-expiry-redirect';

function Probe() {
  const location = useLocation();
  return (
    <p data-testid="probe">
      {location.pathname}
      {location.search}
      {location.hash}|{JSON.stringify(location.state)}
    </p>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionExpiryWatcher />
      <Routes>
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function rejected(path: string) {
  return {
    data: {
      code: 'UNAUTHORIZED',
      httpStatus: 401,
      appCode: APP_ERROR_CODES.UNAUTHORIZED,
      path,
    },
  };
}

const UNREAD = 'notifications.unreadCount';
const ME = 'auth.me';

/** Non-forum public pages from CH-227 27-1. */
const PUBLIC_PAGES = ['/series', '/trade', '/calendar', '/categories', '/search', '/'];

const ORDERS: ReadonlyArray<{ name: string; paths: readonly [string, string] }> = [
  { name: 'unreadCount first, auth.me second', paths: [UNREAD, ME] },
  { name: 'auth.me first, unreadCount second', paths: [ME, UNREAD] },
];

beforeEach(() => {
  resetSessionExpiryRedirectForTests();
  rootStore.session.signOut();
  rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
  clearActiveQueryClient.mockReset();
});

describe('CH-227 27-2: background reads rejected on a non-forum public page', () => {
  for (const page of PUBLIC_PAGES) {
    for (const order of ORDERS) {
      it(`${page}: ${order.name} signs out in place without going to login`, () => {
        renderAt(`${page}?q=1#top`);
        act(() => {
          noteTrpcQueryFailure(rejected(order.paths[0]));
          noteTrpcQueryFailure(rejected(order.paths[1]));
        });
        expect(rootStore.session.token).toBeNull();
        expect(clearActiveQueryClient).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('probe')).toHaveTextContent(`${page}?q=1#top|null`);
      });
    }
  }

  it('a series detail page keeps the reader when only the unread count is rejected', () => {
    renderAt('/series/aurora');
    act(() => noteTrpcQueryFailure(rejected(UNREAD)));
    expect(rootStore.session.token).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent('/series/aurora|null');
  });
});

describe('CH-227 27-A: what still goes to login', () => {
  it('27-4: a rejected comment write on a series page goes to login with sessionExpired', () => {
    renderAt('/series/aurora?tab=comments#c1');
    act(() => noteTrpcFailure(rejected('comments.createForSeries')));
    expect(rootStore.session.token).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent(
      '/login|{"from":"/series/aurora?tab=comments#c1","notice":"sessionExpired"}',
    );
  });

  it('a write rejected after the unread count already signed out still goes to login', () => {
    renderAt('/series/aurora');
    act(() => noteTrpcQueryFailure(rejected(UNREAD)));
    expect(screen.getByTestId('probe')).toHaveTextContent('/series/aurora|null');
    rootStore.session.signIn('token-2', { id: 'u1', username: 'alice', role: 'user' });
    act(() => noteTrpcFailure(rejected('comments.createForSeries')));
    expect(screen.getByTestId('probe')).toHaveTextContent(
      '/login|{"from":"/series/aurora","notice":"sessionExpired"}',
    );
  });

  for (const page of [
    '/me',
    '/notifications',
    '/trade/new',
    '/forum/new',
    '/forum/t1/edit',
    '/reports',
  ]) {
    it(`27-3: ${page} goes to login when the unread count is rejected first`, () => {
      renderAt(`${page}?x=1#h`);
      act(() => {
        noteTrpcQueryFailure(rejected(UNREAD));
        noteTrpcQueryFailure(rejected(ME));
      });
      expect(screen.getByTestId('probe')).toHaveTextContent(
        `/login|{"from":"${page}?x=1#h","notice":"sessionExpired"}`,
      );
    });
  }

  it('CH-203: a card page goes to login when the unread count is rejected first', () => {
    renderAt('/cards/aurora-knight');
    act(() => {
      noteTrpcQueryFailure(rejected(UNREAD));
      noteTrpcQueryFailure(rejected(ME));
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(
      '/login|{"from":"/cards/aurora-knight","notice":"sessionExpired"}',
    );
  });
});
