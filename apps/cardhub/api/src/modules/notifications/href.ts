import type { ContentSurface } from '@repo/shared';
import { notificationTargetVisible } from '../content-security/visibility';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationTarget } from './plan';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function forumTopicHref(slug: string): string | null {
  if (!SLUG.test(slug)) return null;
  return `/forum/${slug}`;
}

export function forumReplyHref(slug: string, replyId: string): string | null {
  if (!SLUG.test(slug) || !ID.test(replyId)) return null;
  return `/forum/${slug}#reply-${replyId}`;
}

export function commentHref(
  kind: 'card' | 'series',
  slug: string,
  id: string,
  parentId: string | null,
): string | null {
  if (!SLUG.test(slug) || !ID.test(id)) return null;
  const base = kind === 'card' ? `/cards/${slug}` : `/series/${slug}`;
  if (parentId !== null && ID.test(parentId)) {
    return `${base}?parentId=${parentId}#reply-${id}`;
  }
  const anchor = parentId === null ? `comment-${id}` : `reply-${id}`;
  return `${base}#${anchor}`;
}

export function listingHref(cardSlug: string): string | null {
  if (!SLUG.test(cardSlug)) return null;
  return `/cards/${cardSlug}`;
}

type HrefRow = { targetType: NotificationTarget; targetId: string };

type LiveTarget = {
  href: string;
  parentId?: string;
};

function commentParentId(parentId: string | null): string | undefined {
  return parentId !== null && ID.test(parentId) ? parentId : undefined;
}

function idsFor(rows: readonly HrefRow[], targetType: NotificationTarget): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.targetType !== targetType || seen.has(row.targetId)) continue;
    seen.add(row.targetId);
    ids.push(row.targetId);
  }
  return ids;
}

function hrefKey(targetType: NotificationTarget, targetId: string): string {
  return `${targetType}:${targetId}`;
}

/**
 * One lookup per target kind on the page (no N+1). A target that is missing,
 * or that `notificationTargetVisible` withholds on this surface (the target
 * itself, the topic of a reply, or the parent of a comment reply), stays out
 * of the map. The caller then returns href null and no excerpt, so stored
 * snapshots written before a target turned RISKY or REVIEW are closed at
 * read time.
 */
export async function liveHrefMap(
  prisma: PrismaService,
  rows: readonly HrefRow[],
  surface: ContentSurface,
): Promise<Map<string, LiveTarget>> {
  const replyIds = idsFor(rows, 'REPLY');
  const commentIds = idsFor(rows, 'COMMENT');
  const topicIds = idsFor(rows, 'TOPIC');
  const listingIds = idsFor(rows, 'LISTING');
  const [replies, comments, topics, listings] = await Promise.all([
    replyIds.length === 0
      ? Promise.resolve([])
      : prisma.reply.findMany({
          where: { id: { in: replyIds } },
          select: {
            id: true,
            safetyStatus: true,
            topic: { select: { slug: true, safetyStatus: true } },
          },
        }),
    commentIds.length === 0
      ? Promise.resolve([])
      : prisma.comment.findMany({
          where: { id: { in: commentIds } },
          select: {
            id: true,
            parentId: true,
            safetyStatus: true,
            parent: { select: { safetyStatus: true } },
            card: { select: { slug: true } },
            series: { select: { slug: true } },
          },
        }),
    topicIds.length === 0
      ? Promise.resolve([])
      : prisma.topic.findMany({
          where: { id: { in: topicIds } },
          select: { id: true, slug: true, safetyStatus: true },
        }),
    listingIds.length === 0
      ? Promise.resolve([])
      : prisma.listing.findMany({
          where: { id: { in: listingIds } },
          select: { id: true, cardSlug: true, safetyStatus: true },
        }),
  ]);

  const visible = (...statuses: Parameters<typeof notificationTargetVisible>[0]['status'][]) =>
    statuses.every((status) => notificationTargetVisible({ surface, status }));

  const map = new Map<string, LiveTarget>();
  for (const reply of replies) {
    if (!visible(reply.safetyStatus, reply.topic.safetyStatus)) continue;
    const href = forumReplyHref(reply.topic.slug, reply.id);
    if (href) map.set(hrefKey('REPLY', reply.id), { href });
  }
  for (const comment of comments) {
    const parentStatus = comment.parent ? [comment.parent.safetyStatus] : [];
    if (!visible(comment.safetyStatus, ...parentStatus)) continue;
    const href = comment.card
      ? commentHref('card', comment.card.slug, comment.id, comment.parentId)
      : comment.series
        ? commentHref('series', comment.series.slug, comment.id, comment.parentId)
        : null;
    if (!href) continue;
    const parentId = commentParentId(comment.parentId);
    map.set(hrefKey('COMMENT', comment.id), parentId ? { href, parentId } : { href });
  }
  for (const topic of topics) {
    if (!visible(topic.safetyStatus)) continue;
    const href = forumTopicHref(topic.slug);
    if (href) map.set(hrefKey('TOPIC', topic.id), { href });
  }
  for (const listing of listings) {
    if (!visible(listing.safetyStatus)) continue;
    const href = listingHref(listing.cardSlug);
    if (href) map.set(hrefKey('LISTING', listing.id), { href });
  }
  return map;
}

export function hrefFor(map: ReadonlyMap<string, LiveTarget>, row: HrefRow): string | null {
  return map.get(hrefKey(row.targetType, row.targetId))?.href ?? null;
}

export function parentIdFor(
  map: ReadonlyMap<string, LiveTarget>,
  row: HrefRow,
): string | undefined {
  return map.get(hrefKey(row.targetType, row.targetId))?.parentId;
}

/**
 * Stored excerpt, only while the target is live and visible (it has an href).
 * A missing or withheld target returns '' so a snapshot frozen before the
 * target turned RISKY / REVIEW, or before it was removed, never leaks.
 */
export function excerptFor(
  map: ReadonlyMap<string, LiveTarget>,
  row: HrefRow & { excerpt: string },
): string {
  return map.has(hrefKey(row.targetType, row.targetId)) ? row.excerpt : '';
}
