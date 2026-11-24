import { describe, expect, it, beforeEach } from 'vitest';
import {
  forgetAllListSessions,
  forgetListSession,
  readListSession,
  readListScroll,
  rememberListSession,
  writeListScroll,
} from './list-session';

describe('list-session', () => {
  beforeEach(() => forgetAllListSessions());

  it('returns a snapshot only when the auth flag matches', () => {
    rememberListSession('forum', {
      data: { items: [1], nextCursor: 'c' },
      extra: [2],
      moreCursor: 'd',
      scrollTop: 172,
      auth: true,
    });
    expect(readListSession('forum', false)).toBeNull();
    const hit = readListSession<{ items: number[]; nextCursor: string }, number>('forum', true);
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
      auth: true,
    });
    expect(readListScroll('trade:all')).toBe(1158);
    expect(readListSession('trade:all', true)?.scrollTop).toBe(1158);
  });

  it('keeps scroll updates and can be forgotten', () => {
    rememberListSession('trade:all', {
      data: { items: [] },
      extra: [],
      moreCursor: null,
      scrollTop: 0,
      auth: false,
    });
    writeListScroll('trade:all', 700);
    expect(readListScroll('trade:all')).toBe(700);
    forgetListSession('trade:all');
    expect(readListSession('trade:all', false)).toBeNull();
  });
});
