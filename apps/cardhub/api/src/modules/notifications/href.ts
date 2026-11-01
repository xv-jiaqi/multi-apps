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
  const anchor = parentId === null ? `comment-${id}` : `reply-${id}`;
  return `${base}#${anchor}`;
}

export function listingHref(cardSlug: string): string | null {
  if (!SLUG.test(cardSlug)) return null;
  return `/cards/${cardSlug}`;
}

type HrefRow = { targetType: NotificationTarget; targetId: string };

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
 * One lookup per target kind on the page. Missing rows stay out of the map,
 * so the caller returns href null after a delete.
 */
export async function liveHrefMap(
  prisma: PrismaService,
  rows: readonly HrefRow[],
): Promise<Map<string, string>> {
  const replyIds = idsFor(rows, 'REPLY');
  const commentIds = idsFor(rows, 'COMMENT');
  const topicIds = idsFor(rows, 'TOPIC');
  const listingIds = idsFor(rows, 'LISTING');
  const [replies, comments, topics, listings] = await Promise.all([
    replyIds.length === 0
      ? Promise.resolve([])
      : prisma.reply.findMany({
          where: { id: { in: replyIds } },
          select: { id: true, topic: { select: { slug: true } } },
        }),
    commentIds.length === 0
      ? Promise.resolve([])
      : prisma.comment.findMany({
          where: { id: { in: commentIds } },
          select: {
            id: true,
            parentId: true,
            card: { select: { slug: true } },
            series: { select: { slug: true } },
          },
        }),
    topicIds.length === 0
      ? Promise.resolve([])
      : prisma.topic.findMany({
          where: { id: { in: topicIds } },
          select: { id: true, slug: true },
        }),
    listingIds.length === 0
      ? Promise.resolve([])
      : prisma.listing.findMany({
          where: { id: { in: listingIds } },
          select: { id: true, cardSlug: true },
        }),
  ]);

  const map = new Map<string, string>();
  for (const reply of replies) {
    const href = forumReplyHref(reply.topic.slug, reply.id);
    if (href) map.set(hrefKey('REPLY', reply.id), href);
  }
  for (const comment of comments) {
    const href = comment.card
      ? commentHref('card', comment.card.slug, comment.id, comment.parentId)
      : comment.series
        ? commentHref('series', comment.series.slug, comment.id, comment.parentId)
        : null;
    if (href) map.set(hrefKey('COMMENT', comment.id), href);
  }
  for (const topic of topics) {
    const href = forumTopicHref(topic.slug);
    if (href) map.set(hrefKey('TOPIC', topic.id), href);
  }
  for (const listing of listings) {
    const href = listingHref(listing.cardSlug);
    if (href) map.set(hrefKey('LISTING', listing.id), href);
  }
  return map;
}

export function hrefFor(map: ReadonlyMap<string, string>, row: HrefRow): string | null {
  return map.get(hrefKey(row.targetType, row.targetId)) ?? null;
}
