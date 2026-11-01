import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_ERROR_CODES } from '@repo/shared';
import { rootStore } from '../stores/root-store';

const clearActiveQueryClient = vi.fn();

vi.mock('./trpc', () => ({
  clearActiveQueryClient: () => clearActiveQueryClient(),
}));

import { applySessionExpiry, resetSessionExpiryRedirectForTests } from './session-expiry-redirect';

function unauthorized(path: string) {
  return {
    data: {
      code: 'UNAUTHORIZED',
      httpStatus: 401,
      appCode: APP_ERROR_CODES.UNAUTHORIZED,
      path,
    },
  };
}

beforeEach(() => {
  resetSessionExpiryRedirectForTests();
  rootStore.session.signOut();
  clearActiveQueryClient.mockReset();
});

describe('applySessionExpiry', () => {
  it('redirects once when two 401s arrive together', () => {
    rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
    const navigate = vi.fn();
    const input = {
      pathname: '/me',
      search: '',
      hash: '',
      navigate,
      error: unauthorized('comments.create'),
    };

    applySessionExpiry(input);
    applySessionExpiry(input);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/login', {
      replace: true,
      state: { from: '/me', notice: 'sessionExpired' },
    });
    expect(rootStore.session.token).toBeNull();
    expect(clearActiveQueryClient).toHaveBeenCalledTimes(1);
  });

  it('does not redirect when auth.me expires on a public page', () => {
    rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
    const navigate = vi.fn();

    applySessionExpiry({
      pathname: '/series',
      search: '?year=2024',
      hash: '#list',
      navigate,
      error: unauthorized('auth.me'),
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(rootStore.session.token).toBeNull();
    expect(clearActiveQueryClient).toHaveBeenCalledTimes(1);
  });

  it('treats a case-insensitive or dot-segment protected path as login-required', () => {
    rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
    const navigate = vi.fn();

    applySessionExpiry({
      pathname: '/Me',
      search: '',
      hash: '',
      navigate,
      error: unauthorized('auth.me'),
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/login', {
      replace: true,
      state: { from: '/Me', notice: 'sessionExpired' },
    });
  });

  it('sends a login or register return path home', () => {
    rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
    const navigate = vi.fn();

    applySessionExpiry({
      pathname: '/register',
      search: '?next=/me',
      hash: '#form',
      navigate,
      error: unauthorized('comments.create'),
    });

    expect(navigate).toHaveBeenCalledWith('/login', {
      replace: true,
      state: { from: '/', notice: 'sessionExpired' },
    });

    resetSessionExpiryRedirectForTests();
    rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
    const dotted = vi.fn();
    applySessionExpiry({
      pathname: '/me/../login',
      search: '',
      hash: '',
      navigate: dotted,
      error: unauthorized('comments.create'),
    });
    expect(dotted).toHaveBeenCalledWith('/login', {
      replace: true,
      state: { from: '/', notice: 'sessionExpired' },
    });
  });
});
