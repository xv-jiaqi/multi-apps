import { describe, expect, it, beforeEach } from 'vitest';
import {
  bindListSessionsToSession,
  forgetAllListSessions,
  forgetListSession,
  listAuthKey,
  readListSession,
  readListScroll,
  rememberListSession,
  writeListScroll,
} from './list-session';

describe('list-session', () => {
  beforeEach(() => forgetAllListSessions());

  it('returns a snapshot only when the user id matches', () => {
    rememberListSession('forum', {
      data: { items: [1], nextCursor: 'c' },
      extra: [2],
      moreCursor: 'd',
      scrollTop: 172,
      auth: 'u1',
    });
    expect(readListSession('forum', null)).toBeNull();
    expect(readListSession('forum', 'u2')).toBeNull();
    const hit = readListSession<{ items: number[]; nextCursor: string }, number>('forum', 'u1');
    expect(hit?.data.items).toEqual([1]);
    expect(hit?.extra).toEqual([2]);
    expect(hit?.scrollTop).toBe(172);
  });

  it('does not let a 0 snapshot overwrite a captured scroll offset', () => {
    writeListScroll('trade:all', 1158);
    rememberListSession('trade:all', {
      data: { items: [1] },
      extra: [],
      moreCursor: null,
      scrollTop: 0,
      auth: 'u1',
    });
    expect(readListScroll('trade:all')).toBe(1158);
    expect(readListSession('trade:all', 'u1')?.scrollTop).toBe(1158);
  });

  it('keeps scroll updates and can be forgotten', () => {
    rememberListSession('trade:all', {
      data: { items: [] },
      extra: [],
      moreCursor: null,
      scrollTop: 0,
      auth: null,
    });
    writeListScroll('trade:all', 700);
    expect(readListScroll('trade:all')).toBe(700);
    forgetListSession('trade:all');
    expect(readListSession('trade:all', null)).toBeNull();
  });

  it('treats a signed-out session as null even if a user object is left behind', () => {
    expect(listAuthKey({ isAuthenticated: false, user: { id: 'u1' } })).toBeNull();
    expect(listAuthKey({ isAuthenticated: true, user: { id: 'u1' } })).toBe('u1');
    expect(listAuthKey({ isAuthenticated: true, user: null })).toBeNull();
  });

  it('clears every list snapshot on sign-out and when a different user signs in', () => {
    const session = {
      user: { id: 'u1', username: 'alice' } as { id: string; username: string } | null,
      signOut() {
        this.user = null;
      },
      signIn(_token: string, user: { id: string; username: string }) {
        this.user = user;
      },
    };
    bindListSessionsToSession(session);
    rememberListSession('forum', {
      data: { items: [1] },
      extra: [],
      moreCursor: null,
      scrollTop: 10,
      auth: 'u1',
    });
    rememberListSession('trade:all', {
      data: { items: [2] },
      extra: [],
      moreCursor: null,
      scrollTop: 20,
      auth: 'u1',
    });
    session.signOut();
    expect(readListSession('forum', 'u1')).toBeNull();
    expect(readListSession('trade:all', 'u1')).toBeNull();

    session.user = { id: 'u1', username: 'alice' };
    rememberListSession('forum', {
      data: { items: [1] },
      extra: [],
      moreCursor: null,
      scrollTop: 10,
      auth: 'u1',
    });
    session.signIn('token', { id: 'u2', username: 'bob' });
    expect(readListSession('forum', 'u1')).toBeNull();
  });
});
