jest.mock('@sentry/node', () => {
  const actual = jest.requireActual('@sentry/node');
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
    throw new Error('@sentry/node mock expected an object');
  }
  return {
    ...actual,
    captureException: jest.fn(() => 'event-id'),
  };
});

import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { notifyAfterCommit, notifyContent, type NotificationDb } from './notify';

function dbOf(users: Array<{ id: string; username: string }>): {
  db: NotificationDb;
  userFindMany: jest.Mock;
  notificationFindMany: jest.Mock;
  createMany: jest.Mock;
} {
  const userFindMany = jest.fn(async () => users);
  const notificationFindMany = jest.fn(async () => []);
  const createMany = jest.fn(async () => ({ count: users.length }));
  const db: NotificationDb = {
    user: { findMany: userFindMany },
    notification: { findMany: notificationFindMany, createMany },
  };
  return { db, userFindMany, notificationFindMany, createMany };
}

describe('notifyContent', () => {
  it('resolves every mention with one user lookup and one insert', async () => {
    const { db, userFindMany, notificationFindMany, createMany } = dbOf([
      { id: 'u-alice', username: 'alice' },
      { id: 'u-cara', username: 'cara' },
      { id: 'u-dana', username: 'dana' },
    ]);
    await notifyContent(db, {
      actorId: 'u-bob',
      body: 'hi @alice @cara @missing @dana @alice',
      excerpt: 'hi',
      targetType: 'REPLY',
      targetId: 'reply-1',
      href: '/forum/topic#reply-reply-1',
      reply: { userId: 'u-alice', type: 'TOPIC_REPLY' },
    });
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(notificationFindMany).not.toHaveBeenCalled();
    expect(createMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0]?.[0]?.data;
    expect(
      Array.isArray(data)
        ? data.map((row: { userId: string; type: string }) => [row.userId, row.type])
        : [],
    ).toEqual([
      ['u-alice', 'TOPIC_REPLY'],
      ['u-cara', 'MENTION'],
      ['u-dana', 'MENTION'],
    ]);
  });

  it('does not query when the body has no mentions and nobody to reply to', async () => {
    const { db, userFindMany, createMany } = dbOf([]);
    await notifyContent(db, {
      actorId: 'u-bob',
      body: 'hello',
      excerpt: 'hello',
      targetType: 'TOPIC',
      targetId: 'topic-1',
      href: '/forum/topic',
      reply: null,
    });
    expect(userFindMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('skips mentions that already exist for the same target with one lookup', async () => {
    const { db, userFindMany, notificationFindMany, createMany } = dbOf([
      { id: 'u-alice', username: 'alice' },
      { id: 'u-dana', username: 'dana' },
    ]);
    notificationFindMany.mockResolvedValueOnce([{ userId: 'u-alice' }]);
    await notifyContent(db, {
      actorId: 'u-bob',
      body: '@alice @dana',
      excerpt: 'edited',
      targetType: 'TOPIC',
      targetId: 'topic-1',
      href: '/forum/topic',
      reply: null,
      dedupeMentions: true,
    });
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(notificationFindMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0]?.[0]?.data;
    expect(Array.isArray(data) ? data.map((row: { userId: string }) => row.userId) : []).toEqual([
      'u-dana',
    ]);
  });
});

describe('notifyAfterCommit', () => {
  it('logs a structured failure and does not throw when the insert fails', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const capture = jest.mocked(Sentry.captureException);
    capture.mockClear();
    const failed = Object.assign(new Error('NOTIFY_WRITE_DOWN'), { code: 'P2021' });
    const { db, createMany } = dbOf([{ id: 'u-alice', username: 'alice' }]);
    createMany.mockRejectedValueOnce(failed);
    await expect(
      notifyAfterCommit(() =>
        notifyContent(db, {
          actorId: 'u-bob',
          body: 'hi @alice',
          excerpt: 'hi',
          targetType: 'TOPIC',
          targetId: 'topic-1',
          href: '/forum/topic',
          reply: null,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith({
      event: 'notification_write_failed',
      code: 'P2021',
    });
    expect(capture).toHaveBeenCalledWith(failed);
    errorSpy.mockRestore();
  });
});
