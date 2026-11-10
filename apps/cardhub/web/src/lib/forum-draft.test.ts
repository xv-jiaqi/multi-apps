import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discardAllForumDrafts,
  discardForumDraft,
  saveReplyDraft,
  saveTopicDraft,
  takeReplyDraft,
  takeTopicDraft,
} from './forum-draft';

const NOW = Date.UTC(2026, 10, 10, 1, 0, 0);
const MINUTE = 60_000;
const TOPIC = '11111111-1111-4111-a111-111111111111';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function stored(key: string): unknown {
  const raw = window.sessionStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}

describe('forum drafts in sessionStorage (CH-226 §7)', () => {
  it('writes the §7-2 keys with the §7-3 value, and replies carry no title', () => {
    saveTopicDraft({
      target: { kind: 'new' },
      userId: 'u1',
      draft: { title: 'T', body: 'B' },
      now: NOW,
    });
    saveTopicDraft({
      target: { kind: 'edit', topicId: TOPIC },
      userId: 'u1',
      draft: { title: 'T2', body: 'B2' },
      now: NOW,
    });
    saveReplyDraft({
      target: { kind: 'reply', topicId: TOPIC },
      userId: 'u1',
      draft: { body: 'R' },
      now: NOW,
    });

    expect(stored('cardhub:draft:forum:new')).toEqual({
      v: 1,
      userId: 'u1',
      savedAt: NOW,
      title: 'T',
      body: 'B',
    });
    expect(stored(`cardhub:draft:forum:edit:${TOPIC}`)).toEqual({
      v: 1,
      userId: 'u1',
      savedAt: NOW,
      title: 'T2',
      body: 'B2',
    });
    expect(stored(`cardhub:draft:forum:reply:${TOPIC}`)).toEqual({
      v: 1,
      userId: 'u1',
      savedAt: NOW,
      body: 'R',
    });
  });

  it('does not write content that is all whitespace (§7-4)', () => {
    saveTopicDraft({ target: { kind: 'new' }, userId: 'u1', draft: { title: '  ', body: '\n\t' } });
    saveReplyDraft({
      target: { kind: 'reply', topicId: TOPIC },
      userId: 'u1',
      draft: { body: '   ' },
    });
    expect(window.sessionStorage.length).toBe(0);
  });

  it('restores for the same user and deletes the key at once', () => {
    saveTopicDraft({
      target: { kind: 'new' },
      userId: 'u1',
      draft: { title: 'T', body: 'B' },
      now: NOW,
    });
    expect(takeTopicDraft({ target: { kind: 'new' }, userId: 'u1', now: NOW + MINUTE })).toEqual({
      kind: 'restored',
      draft: { title: 'T', body: 'B' },
    });
    expect(window.sessionStorage.getItem('cardhub:draft:forum:new')).toBeNull();
    expect(takeTopicDraft({ target: { kind: 'new' }, userId: 'u1', now: NOW + MINUTE })).toEqual({
      kind: 'none',
    });
  });

  it('26-5: B never gets A’s draft, the key is gone, and A does not get it later', () => {
    const target = { kind: 'reply', topicId: TOPIC } satisfies { kind: 'reply'; topicId: string };
    saveReplyDraft({ target, userId: 'user-a', draft: { body: 'A wrote this' }, now: NOW });
    expect(takeReplyDraft({ target, userId: 'user-b', now: NOW })).toEqual({ kind: 'none' });
    expect(window.sessionStorage.getItem(`cardhub:draft:forum:reply:${TOPIC}`)).toBeNull();
    expect(takeReplyDraft({ target, userId: 'user-a', now: NOW })).toEqual({ kind: 'none' });
  });

  it('26-6: restores at exactly 60 minutes, not one millisecond after', () => {
    const target = { kind: 'reply', topicId: TOPIC } satisfies { kind: 'reply'; topicId: string };
    saveReplyDraft({ target, userId: 'u1', draft: { body: 'R' }, now: NOW });
    expect(takeReplyDraft({ target, userId: 'u1', now: NOW + 60 * MINUTE }).kind).toBe('restored');

    saveReplyDraft({ target, userId: 'u1', draft: { body: 'R' }, now: NOW });
    expect(takeReplyDraft({ target, userId: 'u1', now: NOW + 60 * MINUTE + 1 })).toEqual({
      kind: 'none',
    });
    expect(window.sessionStorage.getItem(`cardhub:draft:forum:reply:${TOPIC}`)).toBeNull();
  });

  it.each([
    ['broken JSON', '{"v":1,'],
    ['v is not 1', JSON.stringify({ v: 2, userId: 'u1', savedAt: NOW, title: 'T', body: 'B' })],
    [
      'a topic draft without a title',
      JSON.stringify({ v: 1, userId: 'u1', savedAt: NOW, body: 'B' }),
    ],
    [
      'a string savedAt',
      JSON.stringify({ v: 1, userId: 'u1', savedAt: `${NOW}`, title: 'T', body: 'B' }),
    ],
    ['JSON null', 'null'],
  ])('26-6: %s is dropped without restoring or throwing', (_label, raw) => {
    window.sessionStorage.setItem('cardhub:draft:forum:new', raw);
    expect(takeTopicDraft({ target: { kind: 'new' }, userId: 'u1', now: NOW })).toEqual({
      kind: 'none',
    });
    expect(window.sessionStorage.getItem('cardhub:draft:forum:new')).toBeNull();
  });

  it('26-6: a sessionStorage that throws on every call is a silent no-op', () => {
    const fail = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(fail);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(fail);
    vi.spyOn(Storage.prototype, 'key').mockImplementation(fail);

    expect(() =>
      saveTopicDraft({ target: { kind: 'new' }, userId: 'u1', draft: { title: 'T', body: 'B' } }),
    ).not.toThrow();
    expect(takeTopicDraft({ target: { kind: 'new' }, userId: 'u1' })).toEqual({ kind: 'none' });
    expect(() => discardForumDraft({ kind: 'new' })).not.toThrow();
    expect(() => discardAllForumDrafts()).not.toThrow();
  });

  it('26-7: header sign-out removes every cardhub:draft:forum:* key and nothing else', () => {
    saveTopicDraft({ target: { kind: 'new' }, userId: 'u1', draft: { title: 'T', body: 'B' } });
    saveTopicDraft({
      target: { kind: 'edit', topicId: TOPIC },
      userId: 'u1',
      draft: { title: 'T', body: 'B' },
    });
    saveReplyDraft({
      target: { kind: 'reply', topicId: TOPIC },
      userId: 'u1',
      draft: { body: 'R' },
    });
    window.sessionStorage.setItem('cardhub:legacyPasswordLater', '1');

    discardAllForumDrafts();

    expect(Object.keys(window.sessionStorage)).toEqual(['cardhub:legacyPasswordLater']);
  });

  it('26-7: discarding one target leaves the others', () => {
    saveTopicDraft({ target: { kind: 'new' }, userId: 'u1', draft: { title: 'T', body: 'B' } });
    saveReplyDraft({
      target: { kind: 'reply', topicId: TOPIC },
      userId: 'u1',
      draft: { body: 'R' },
    });
    discardForumDraft({ kind: 'new' });
    expect(Object.keys(window.sessionStorage)).toEqual([`cardhub:draft:forum:reply:${TOPIC}`]);
  });
});
