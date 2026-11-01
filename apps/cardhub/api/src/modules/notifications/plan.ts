import { MENTION_LIMIT, mentionUsernames } from './mentions';

export const NOTIFICATION_EXCERPT_MAX = 80;

export type ContentNotificationType = 'TOPIC_REPLY' | 'COMMENT_REPLY' | 'MENTION';

export type NotificationKind = ContentNotificationType | 'CONTENT_RESOLVED';

export type NotificationResolveAction = 'MARK_RESOLVED' | 'REMOVE_TARGET';

export type NotificationTarget = 'LISTING' | 'TOPIC' | 'REPLY' | 'COMMENT';

export type PlannedNotification = {
  userId: string;
  actorId: string | null;
  type: NotificationKind;
  action: NotificationResolveAction | null;
  targetType: NotificationTarget;
  targetId: string;
  excerpt: string;
  href: string | null;
};

export type KnownUser = { id: string; username: string };

/** Collapse whitespace, then keep the first 80 characters. */
export function notificationExcerpt(source: string): string {
  const collapsed = source.replace(/\s+/g, ' ').trim();
  const chars = Array.from(collapsed);
  if (chars.length <= NOTIFICATION_EXCERPT_MAX) return collapsed;
  return chars.slice(0, NOTIFICATION_EXCERPT_MAX).join('');
}

export function resolveMentionIds(names: readonly string[], users: readonly KnownUser[]): string[] {
  const byName = new Map(users.map((user) => [user.username, user.id]));
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const id = byName.get(name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * One row per recipient. A person who is both the reply target and an
 * @mention gets the reply type only. The actor and unknown ids are skipped.
 */
export function planContentNotifications(input: {
  actorId: string;
  mentionUserIds: readonly string[];
  excerpt: string;
  targetType: NotificationTarget;
  targetId: string;
  href: string | null;
  reply: { userId: string; type: 'TOPIC_REPLY' | 'COMMENT_REPLY' } | null;
}): PlannedNotification[] {
  const excerpt = notificationExcerpt(input.excerpt);
  const rows: PlannedNotification[] = [];
  const replyUserId =
    input.reply && input.reply.userId !== input.actorId ? input.reply.userId : null;
  if (input.reply && replyUserId) {
    rows.push({
      userId: replyUserId,
      actorId: input.actorId,
      type: input.reply.type,
      action: null,
      targetType: input.targetType,
      targetId: input.targetId,
      excerpt,
      href: input.href,
    });
  }

  const seen = new Set<string>();
  if (replyUserId) seen.add(replyUserId);
  seen.add(input.actorId);
  for (const userId of input.mentionUserIds.slice(0, MENTION_LIMIT)) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    rows.push({
      userId,
      actorId: input.actorId,
      type: 'MENTION',
      action: null,
      targetType: input.targetType,
      targetId: input.targetId,
      excerpt,
      href: input.href,
    });
  }
  return rows;
}

/** Parse the body, then apply the reply / self / missing-user rules. */
export function planMentionsFromText(input: {
  actorId: string;
  body: string;
  users: readonly KnownUser[];
  excerpt: string;
  targetType: NotificationTarget;
  targetId: string;
  href: string | null;
  reply: { userId: string; type: 'TOPIC_REPLY' | 'COMMENT_REPLY' } | null;
}): PlannedNotification[] {
  const names = mentionUsernames(input.body);
  return planContentNotifications({
    actorId: input.actorId,
    mentionUserIds: resolveMentionIds(names, input.users),
    excerpt: input.excerpt,
    targetType: input.targetType,
    targetId: input.targetId,
    href: input.href,
    reply: input.reply,
  });
}

/**
 * One moderation notice for the content author. The moderator is not stored.
 * Closing a listing keeps the card href because the row is not deleted.
 */
export function planModerationNotification(input: {
  authorId: string | null;
  moderatorId: string;
  action: NotificationResolveAction;
  targetType: NotificationTarget;
  targetId: string;
  excerpt: string;
  href: string | null;
}): PlannedNotification | null {
  if (!input.authorId || input.authorId === input.moderatorId) return null;
  const removed = input.action === 'REMOVE_TARGET' && input.targetType !== 'LISTING';
  return {
    userId: input.authorId,
    actorId: null,
    type: 'CONTENT_RESOLVED',
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    excerpt: notificationExcerpt(input.excerpt),
    href: removed ? null : input.href,
  };
}
