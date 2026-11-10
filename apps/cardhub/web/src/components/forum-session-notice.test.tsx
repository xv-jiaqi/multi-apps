import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { APP_ERROR_CODES } from '@repo/shared';
import { rootStore } from '../stores/root-store';

vi.mock('../lib/trpc', () => ({ clearActiveQueryClient: vi.fn(), trpc: {} }));

import { ForumSessionNotice } from './forum-session-notice';
import { SessionExpiryWatcher } from './session-expiry-watcher';
import { noteTrpcFailure, noteTrpcQueryFailure } from '../lib/session-expiry';
import { resetSessionExpiryRedirectForTests } from '../lib/session-expiry-redirect';
import { resetForumSessionNoticeForTests } from '../lib/forum-session-notice';

const SESSION_EXPIRED = '登录已失效，请重新登录。';

function rejected(path: string) {
  return {
    data: { code: 'UNAUTHORIZED', httpStatus: 401, appCode: APP_ERROR_CODES.UNAUTHORIZED, path },
  };
}

function Where() {
  const location = useLocation();
  return (
    <p data-testid="where">
      {location.pathname}
      {location.search}
      {location.hash}|{JSON.stringify(location.state)}
    </p>
  );
}

function ForumPage() {
  return (
    <main>
      <ForumSessionNotice />
      <Link to="/series">series</Link>
      <Where />
    </main>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionExpiryWatcher />
      <Routes>
        <Route path="/forum" element={<ForumPage />} />
        <Route path="/forum/:slug" element={<ForumPage />} />
        <Route path="/series" element={<ForumPage />} />
        <Route path="/login" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function noticeStatuses(): HTMLElement[] {
  return screen
    .queryAllByRole('status')
    .filter((node) => node.textContent?.includes(SESSION_EXPIRED));
}

beforeEach(() => {
  resetSessionExpiryRedirectForTests();
  resetForumSessionNoticeForTests();
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
});

describe('forum session-expired notice (CH-226 §6)', () => {
  it.each(['/forum?page=2#top', '/forum/some-topic?parent=1#reply-3'])(
    '26-1: %s stays put and shows exactly one status with a login link',
    (path) => {
      renderAt(path);
      const focusedBefore = document.activeElement;
      act(() => noteTrpcQueryFailure(rejected('auth.me')));

      expect(rootStore.session.token).toBeNull();
      expect(screen.getByTestId('where')).toHaveTextContent(`${path}|null`);
      const statuses = noticeStatuses();
      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toHaveTextContent(`${SESSION_EXPIRED} 登录`);
      expect(document.activeElement).toBe(focusedBefore);
    },
  );

  it('26-1: a rejected background read other than auth.me (header unread count) also stays', () => {
    renderAt('/forum/some-topic');
    act(() => noteTrpcQueryFailure(rejected('notifications.unreadCount')));
    expect(screen.getByTestId('where')).toHaveTextContent('/forum/some-topic|null');
    expect(noticeStatuses()).toHaveLength(1);
  });

  it('§6-7: several rejected requests in one expiry still show one notice', () => {
    renderAt('/forum');
    act(() => {
      noteTrpcQueryFailure(rejected('notifications.unreadCount'));
      noteTrpcQueryFailure(rejected('auth.me'));
    });
    expect(noticeStatuses()).toHaveLength(1);
  });

  it('26-2: the login link keeps query and hash in state.from and sends no notice', async () => {
    const user = userEvent.setup();
    renderAt('/forum/some-topic?parent=1#reply-3');
    act(() => noteTrpcQueryFailure(rejected('auth.me')));

    await user.click(screen.getByRole('link', { name: '登录' }));
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/login|{"from":"/forum/some-topic?parent=1#reply-3"}',
    );
  });

  it('§6-7: signing in again removes the notice', () => {
    renderAt('/forum');
    act(() => noteTrpcQueryFailure(rejected('auth.me')));
    expect(noticeStatuses()).toHaveLength(1);
    act(() => rootStore.session.signIn('token-2', { id: 'u1', username: 'alice', role: 'user' }));
    expect(noticeStatuses()).toHaveLength(0);
  });

  it('§6-7: a new pathname removes it, and it does not come back on return', async () => {
    const user = userEvent.setup();
    renderAt('/forum');
    act(() => noteTrpcQueryFailure(rejected('auth.me')));
    await user.click(screen.getByRole('link', { name: 'series' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/series');
    expect(noticeStatuses()).toHaveLength(0);
  });

  it('§6-3: the status container is mounted and empty when there is nothing to say', () => {
    renderAt('/forum');
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    expect(status).toHaveClass('sr-only');
  });

  it('§6-1: a visitor who was never signed in sees no notice', () => {
    rootStore.session.signOut();
    renderAt('/forum');
    act(() => noteTrpcQueryFailure(rejected('auth.me')));
    expect(noticeStatuses()).toHaveLength(0);
  });

  it('§6-1: other public pages keep CH-212 (sign out, no notice), and do not show it later', async () => {
    renderAt('/series');
    act(() => noteTrpcQueryFailure(rejected('auth.me')));
    expect(screen.getByTestId('where')).toHaveTextContent('/series|null');
    expect(noticeStatuses()).toHaveLength(0);
  });

  it('26-9: a rejected write on a forum page still goes to login with sessionExpired', () => {
    renderAt('/forum/some-topic');
    act(() => noteTrpcFailure(rejected('forum.replies.create')));
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/login|{"from":"/forum/some-topic","notice":"sessionExpired"}',
    );
  });

  it('shows the English copy in en-US', () => {
    rootStore.locale.setLocale('en-US');
    renderAt('/forum');
    act(() => noteTrpcQueryFailure(rejected('auth.me')));
    expect(
      screen
        .getAllByRole('status')
        .find((node) => node.textContent?.includes('Your session has ended.')),
    ).toHaveTextContent('Your session has ended. Sign in again. Sign in');
  });
});
