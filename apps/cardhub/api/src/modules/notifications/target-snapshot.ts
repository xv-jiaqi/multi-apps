import type { Prisma } from '@prisma/client';
import { commentHref, forumReplyHref, forumTopicHref, listingHref } from './href';
import { notificationExcerpt, type NotificationTarget } from './plan';

export type TargetSnapshot = {
  found: boolean;
  userId: string | null;
  excerpt: string;
  href: string | null;
};

function missing(): TargetSnapshot {
  return { found: false, userId: null, excerpt: '', href: null };
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function slugOf(value: { slug?: unknown } | null | undefined): string | null {
  return typeof value?.slug === 'string' ? value.slug : null;
}

/**
 * One read of the reported row, including the text we freeze into excerpt.
 * Partial rows (unit-test doubles) yield found with a null author.
 */
export async function readTargetSnapshot(
  tx: Prisma.TransactionClient,
  targetType: NotificationTarget,
  targetId: string,
): Promise<TargetSnapshot> {
  switch (targetType) {
    case 'LISTING':
      return listingSnapshot(tx, targetId);
    case 'TOPIC':
      return topicSnapshot(tx, targetId);
    case 'REPLY':
      return replySnapshot(tx, targetId);
    case 'COMMENT':
      return commentSnapshot(tx, targetId);
  }
}

async function listingSnapshot(
  tx: Prisma.TransactionClient,
  targetId: string,
): Promise<TargetSnapshot> {
  const row = await tx.listing.findUnique({
    where: { id: targetId },
    select: { userId: true, note: true, cardSlug: true },
  });
  if (!row) return missing();
  const cardSlug = textOf(row.cardSlug);
  return {
    found: true,
    userId: idOf(row.userId),
    excerpt: notificationExcerpt(textOf(row.note)),
    href: cardSlug ? listingHref(cardSlug) : null,
  };
}

async function topicSnapshot(
  tx: Prisma.TransactionClient,
  targetId: string,
): Promise<TargetSnapshot> {
  const row = await tx.topic.findUnique({
    where: { id: targetId },
    select: { userId: true, body: true, slug: true },
  });
  if (!row) return missing();
  const slug = textOf(row.slug);
  return {
    found: true,
    userId: idOf(row.userId),
    excerpt: notificationExcerpt(textOf(row.body)),
    href: slug ? forumTopicHref(slug) : null,
  };
}

async function replySnapshot(
  tx: Prisma.TransactionClient,
  targetId: string,
): Promise<TargetSnapshot> {
  const row = await tx.reply.findUnique({
    where: { id: targetId },
    select: { userId: true, body: true, topic: { select: { slug: true } } },
  });
  if (!row) return missing();
  const slug = slugOf(row.topic);
  return {
    found: true,
    userId: idOf(row.userId),
    excerpt: notificationExcerpt(textOf(row.body)),
    href: slug ? forumReplyHref(slug, targetId) : null,
  };
}

async function commentSnapshot(
  tx: Prisma.TransactionClient,
  targetId: string,
): Promise<TargetSnapshot> {
  const row = await tx.comment.findUnique({
    where: { id: targetId },
    select: {
      userId: true,
      content: true,
      parentId: true,
      card: { select: { slug: true } },
      series: { select: { slug: true } },
    },
  });
  if (!row) return missing();
  const parentId = idOf(row.parentId);
  const cardSlug = slugOf(row.card);
  const seriesSlug = slugOf(row.series);
  const href = cardSlug
    ? commentHref('card', cardSlug, targetId, parentId)
    : seriesSlug
      ? commentHref('series', seriesSlug, targetId, parentId)
      : null;
  return {
    found: true,
    userId: idOf(row.userId),
    excerpt: notificationExcerpt(textOf(row.content)),
    href,
  };
}
