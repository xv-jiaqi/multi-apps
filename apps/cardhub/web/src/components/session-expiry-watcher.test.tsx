import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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
      {location.pathname}|{JSON.stringify(location.state)}
    </p>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionExpiryWatcher />
      <Routes>
        <Route path="/forum/topic" element={<Probe />} />
        <Route path="/login" element={<Probe />} />
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
  it('sends a protected page to login when the bearer token is rejected', () => {
    renderAt('/forum/topic');
    act(() => {
      noteTrpcFailure({ data: { code: 'UNAUTHORIZED', path: 'comments.create' } });
    });
    expect(rootStore.session.token).toBeNull();
    expect(clearActiveQueryClient).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent(
      '/login|{"from":"/forum/topic","notice":"sessionExpired"}',
    );
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

  it('does not treat a failed login as an expired session', () => {
    renderAt('/login');
    act(() => {
      noteTrpcFailure({ data: { code: 'UNAUTHORIZED', path: 'auth.login' } });
    });
    expect(rootStore.session.token).toBe('token');
    expect(clearActiveQueryClient).not.toHaveBeenCalled();
  });
});
