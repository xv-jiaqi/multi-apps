import { randomUUID } from 'node:crypto';
import { mentionUsernames } from './mentions';
import {
  planContentNotifications,
  planModerationNotification,
  resolveMentionIds,
  type NotificationKind,
  type NotificationResolveAction,
  type NotificationTarget,
  type PlannedNotification,
} from './plan';

type MentionUser = { id: string; username: string };

type NotificationInsert = {
  id: string;
  userId: string;
  actorId: string | null;
  type: NotificationKind;
  action: NotificationResolveAction | null;
  targetType: NotificationTarget;
  targetId: string;
  excerpt: string;
  href: string | null;
  createdAt: Date;
};

/**
 * The methods the fan-out actually calls. A transaction client satisfies this.
 * Tests pass a counter so list/trigger code cannot hide an N+1 behind Prisma.
 */
export interface NotificationDb {
  user: {
    findMany(args: {
      where: { username: { in: string[] } };
      select: { id: true; username: true };
    }): Promise<MentionUser[]>;
  };
  notification: {
    findMany(args: {
      where: {
        type: 'MENTION';
        targetType: NotificationTarget;
        targetId: string;
        userId: { in: string[] };
      };
      select: { userId: true };
    }): Promise<Array<{ userId: string }>>;
    createMany(args: { data: NotificationInsert[] }): Promise<unknown>;
  };
}

type NotifyDb = NotificationDb;

export function contentMayNotify(
  body: string,
  replyUserId: string | null,
  actorId: string,
): boolean {
  if (replyUserId !== null && replyUserId !== actorId) return true;
  return mentionUsernames(body).length > 0;
}

export async function notifyContent(
  db: NotifyDb,
  input: {
    actorId: string;
    body: string;
    excerpt: string;
    targetType: NotificationTarget;
    targetId: string;
    href: string | null;
    reply: { userId: string; type: 'TOPIC_REPLY' | 'COMMENT_REPLY' } | null;
    dedupeMentions?: boolean;
  },
): Promise<void> {
  const names = mentionUsernames(input.body);
  const users =
    names.length === 0
      ? []
      : await db.user.findMany({
          where: { username: { in: names } },
          select: { id: true, username: true },
        });
  let rows = planContentNotifications({
    actorId: input.actorId,
    mentionUserIds: resolveMentionIds(names, users),
    excerpt: input.excerpt,
    targetType: input.targetType,
    targetId: input.targetId,
    href: input.href,
    reply: input.reply,
  });
  if (input.dedupeMentions) rows = await dropExistingMentions(db, input, rows);
  await insertNotifications(db, rows);
}

export async function insertNotifications(
  db: NotifyDb,
  rows: readonly PlannedNotification[],
): Promise<void> {
  if (rows.length === 0) return;
  const createdAt = new Date();
  await db.notification.createMany({
    data: rows.map((row) => ({
      id: randomUUID(),
      userId: row.userId,
      actorId: row.actorId,
      type: row.type,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      excerpt: row.excerpt,
      href: row.href,
      createdAt,
    })),
  });
}

export async function notifyModeration(
  db: NotifyDb,
  input: Parameters<typeof planModerationNotification>[0],
): Promise<void> {
  const planned = planModerationNotification(input);
  if (!planned) return;
  await insertNotifications(db, [planned]);
}

async function dropExistingMentions(
  db: NotifyDb,
  input: { targetType: NotificationTarget; targetId: string },
  rows: PlannedNotification[],
): Promise<PlannedNotification[]> {
  const mentionIds = rows.filter((row) => row.type === 'MENTION').map((row) => row.userId);
  if (mentionIds.length === 0) return rows;
  const existing = await db.notification.findMany({
    where: {
      type: 'MENTION',
      targetType: input.targetType,
      targetId: input.targetId,
      userId: { in: mentionIds },
    },
    select: { userId: true },
  });
  const already = new Set(existing.map((row) => row.userId));
  return rows.filter((row) => row.type !== 'MENTION' || !already.has(row.userId));
}
