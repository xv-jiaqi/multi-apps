import { notificationExcerpt, planMentionsFromText, planModerationNotification } from './plan';

const users = [
  { id: 'u-alice', username: 'alice' },
  { id: 'u-bob', username: 'bob' },
  { id: 'u-cara', username: 'cara' },
  { id: 'u-dana', username: 'dana' },
];

const base = {
  actorId: 'u-bob',
  excerpt: 'hello',
  targetType: 'REPLY',
  targetId: 'reply-1',
  href: '/forum/topic#reply-reply-1',
  users,
} satisfies {
  actorId: string;
  excerpt: string;
  targetType: 'REPLY';
  targetId: string;
  href: string;
  users: typeof users;
};

describe('notificationExcerpt', () => {
  it('keeps at most 80 characters after collapsing whitespace', () => {
    expect(notificationExcerpt('  a \n b  ')).toBe('a b');
    expect(notificationExcerpt('字'.repeat(90))).toBe('字'.repeat(80));
    expect(Array.from(notificationExcerpt('字'.repeat(90))).length).toBe(80);
  });
});

describe('planMentionsFromText', () => {
  it('notifies a topic author once even when the reply also @mentions them', () => {
    const rows = planMentionsFromText({
      ...base,
      body: 'hi @alice @alice @cara @missing',
      reply: { userId: 'u-alice', type: 'TOPIC_REPLY' },
    });
    expect(rows.map((row) => [row.userId, row.type])).toEqual([
      ['u-alice', 'TOPIC_REPLY'],
      ['u-cara', 'MENTION'],
    ]);
    expect(rows.every((row) => row.actorId === 'u-bob' && row.action === null)).toBe(true);
  });

  it('skips self replies, self mentions, and names that are not users', () => {
    const rows = planMentionsFromText({
      ...base,
      actorId: 'u-alice',
      body: '@alice @bob `@cara`',
      reply: { userId: 'u-alice', type: 'COMMENT_REPLY' },
    });
    expect(rows).toEqual([
      expect.objectContaining({ userId: 'u-bob', type: 'MENTION', actorId: 'u-alice' }),
    ]);
  });

  it('does not notify the 11th distinct name even when that user exists', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `u-${index}`,
      username: `user${index + 10}`,
    }));
    const body = many.map((user) => `@${user.username}`).join(' ');
    const rows = planMentionsFromText({
      ...base,
      actorId: 'u-author',
      body,
      users: many,
      reply: null,
    });
    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.userId)).toEqual(many.slice(0, 10).map((user) => user.id));
    expect(rows.some((row) => row.userId === 'u-10')).toBe(false);
  });

  it('matches usernames with their original case', () => {
    const rows = planMentionsFromText({
      ...base,
      body: '@Alice',
      users: [{ id: 'u-alice', username: 'alice' }],
      reply: null,
    });
    expect(rows).toEqual([]);
  });
});

describe('planModerationNotification', () => {
  it('tells the author, hides the moderator, and nulls href only when the row is deleted', () => {
    const marked = planModerationNotification({
      authorId: 'u-alice',
      moderatorId: 'u-admin',
      action: 'MARK_RESOLVED',
      targetType: 'TOPIC',
      targetId: 'topic-1',
      excerpt: 'body',
      href: '/forum/topic',
    });
    expect(marked).toMatchObject({
      userId: 'u-alice',
      actorId: null,
      type: 'CONTENT_RESOLVED',
      action: 'MARK_RESOLVED',
      href: '/forum/topic',
    });

    const removed = planModerationNotification({
      authorId: 'u-alice',
      moderatorId: 'u-admin',
      action: 'REMOVE_TARGET',
      targetType: 'COMMENT',
      targetId: 'comment-1',
      excerpt: 'body',
      href: '/cards/slug#comment-comment-1',
    });
    expect(removed?.href).toBeNull();
    expect(removed?.actorId).toBeNull();

    const closed = planModerationNotification({
      authorId: 'u-alice',
      moderatorId: 'u-admin',
      action: 'REMOVE_TARGET',
      targetType: 'LISTING',
      targetId: 'listing-1',
      excerpt: 'note',
      href: '/cards/slug',
    });
    expect(closed?.href).toBe('/cards/slug');
    expect(planModerationNotification({ ...closedInput(), authorId: 'u-admin' })).toBeNull();
    expect(planModerationNotification({ ...closedInput(), authorId: null })).toBeNull();
  });
});

function closedInput(): {
  authorId: string;
  moderatorId: string;
  action: 'REMOVE_TARGET';
  targetType: 'LISTING';
  targetId: string;
  excerpt: string;
  href: string;
} {
  return {
    authorId: 'u-admin',
    moderatorId: 'u-admin',
    action: 'REMOVE_TARGET',
    targetType: 'LISTING',
    targetId: 'listing-1',
    excerpt: 'note',
    href: '/cards/slug',
  };
}
