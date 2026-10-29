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
import { noteTrpcFailure } from '../lib/session-expiry';

function Probe() {
  const location = useLocation();
  return (
    <p data-testid="probe">
      {location.pathname}
      {location.search}|{JSON.stringify(location.state)}
    </p>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionExpiryWatcher />
      <Routes>
        <Route path="/forum" element={<Probe />} />
        <Route path="/forum/topic" element={<Probe />} />
        <Route path="/cards/:cardSlug" element={<Probe />} />
        <Route path="/login" element={<Probe />} />
        <Route path="/me" element={<Probe />} />
        <Route path="/me/password" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.session.signOut();
  rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
  clearActiveQueryClient.mockReset();
});

describe('SessionExpiryWatcher', () => {
  it('sends a protected page to login when the session appCode is rejected', () => {
    renderAt('/me');
    act(() => {
      noteTrpcFailure({
        data: {
          code: 'UNAUTHORIZED',
          httpStatus: 401,
          appCode: APP_ERROR_CODES.UNAUTHORIZED,
          path: 'comments.create',
        },
      });
    });
    expect(rootStore.session.token).toBeNull();
    expect(clearActiveQueryClient).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent(
      '/login|{"from":"/me","notice":"sessionExpired"}',
    );
  });

  it('signs out on a public page without leaving it', () => {
    renderAt('/forum');
    act(() => {
      noteTrpcFailure({
        data: {
          code: 'UNAUTHORIZED',
          httpStatus: 401,
          appCode: APP_ERROR_CODES.UNAUTHORIZED,
          path: 'auth.me',
        },
      });
    });
    expect(rootStore.session.token).toBeNull();
    expect(clearActiveQueryClient).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent('/forum|null');
  });

  it('does not sign out on HTTP 401 alone', () => {
    renderAt('/forum/topic');
    act(() => {
      noteTrpcFailure({
        data: { code: 'UNAUTHORIZED', httpStatus: 401, path: 'comments.create' },
      });
    });
    expect(rootStore.session.token).toBe('token');
    expect(clearActiveQueryClient).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe')).toHaveTextContent('/forum/topic|null');
  });

  it('leaves a wrong-password response on the password page', () => {
    renderAt('/me/password');
    act(() => {
      noteTrpcFailure({
        data: { code: 'UNAUTHORIZED', appCode: 'WRONG_PASSWORD', path: 'auth.changePassword' },
      });
    });
    expect(rootStore.session.token).toBe('token');
    expect(screen.getByTestId('probe')).toHaveTextContent('/me/password|null');
  });

  it('sends a card page to login when collection.byCard rejects the stored session', () => {
    renderAt('/cards/aurora-knight?tab=1#own');
    act(() => {
      noteTrpcFailure({
        data: {
          code: 'UNAUTHORIZED',
          httpStatus: 401,
          appCode: APP_ERROR_CODES.UNAUTHORIZED,
          path: 'collection.byCard',
        },
      });
    });
    expect(rootStore.session.token).toBeNull();
    expect(clearActiveQueryClient).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent(
      '/login|{"from":"/cards/aurora-knight?tab=1#own","notice":"sessionExpired"}',
    );
    expect(screen.getByTestId('probe')).not.toHaveTextContent('redirect=');
  });

  it('sends a card page to login when auth.me rejects the token before byCard is handled', () => {
    renderAt('/cards/aurora-knight');
    act(() => {
      noteTrpcFailure({
        data: {
          code: 'UNAUTHORIZED',
          httpStatus: 401,
          appCode: APP_ERROR_CODES.UNAUTHORIZED,
          path: 'auth.me',
        },
      });
    });
    expect(rootStore.session.token).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent(
      '/login|{"from":"/cards/aurora-knight","notice":"sessionExpired"}',
    );
  });

  it('returns a public forum page to login when a write is rejected', () => {
    renderAt('/forum/topic');
    act(() => {
      noteTrpcFailure({
        data: {
          code: 'UNAUTHORIZED',
          httpStatus: 401,
          appCode: APP_ERROR_CODES.UNAUTHORIZED,
          path: 'comments.create',
        },
      });
    });
    expect(rootStore.session.token).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent(
      '/login|{"from":"/forum/topic","notice":"sessionExpired"}',
    );
  });

  it('does not treat a failed login as an expired session', () => {
    renderAt('/login');
    act(() => {
      noteTrpcFailure({ data: { code: 'UNAUTHORIZED', path: 'auth.login' } });
    });
    expect(rootStore.session.token).toBe('token');
    expect(clearActiveQueryClient).not.toHaveBeenCalled();
  });
});
