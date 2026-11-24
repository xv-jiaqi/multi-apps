import { Prisma } from '@prisma/client';
import type { ContentSurface } from '@repo/shared';

export type ContentSafetyStatusName = 'UNCHECKED' | 'REVIEW' | 'PASS' | 'RISKY';
export type ContentSafetyResultName = 'unchecked' | 'pass' | 'review' | 'risky' | 'pending';

/** Structural filter shared by topics, replies, comments, and listings. */
export type PublicSafetyWhere =
  | { safetyStatus: 'PASS' }
  | { safetyStatus: { in: Array<'PASS' | 'UNCHECKED'> } }
  | {
      OR: [
        { safetyStatus: 'PASS' } | { safetyStatus: { in: Array<'PASS' | 'UNCHECKED'> } },
        { safetyStatus: 'REVIEW'; userId: string },
      ];
    };

export function resolveContentSurface(surface: ContentSurface | undefined): ContentSurface {
  return surface ?? 'web';
}

export function toSafetyStatusDto(
  status: ContentSafetyStatusName,
): Exclude<ContentSafetyResultName, 'pending'> {
  if (status === 'UNCHECKED') return 'unchecked';
  if (status === 'REVIEW') return 'review';
  if (status === 'PASS') return 'pass';
  return 'risky';
}

/**
 * Public list/detail filter. Default `web` keeps today's behaviour for
 * UNCHECKED rows. Miniapp public reads only return PASS, plus the viewer's
 * own REVIEW rows.
 */
export function publicSafetyWhere(args: {
  surface: ContentSurface;
  viewerId?: string | null;
}): PublicSafetyWhere {
  const viewerId = args.viewerId ?? undefined;
  if (args.surface === 'miniapp') {
    if (viewerId) {
      return {
        OR: [{ safetyStatus: 'PASS' }, { safetyStatus: 'REVIEW', userId: viewerId }],
      };
    }
    return { safetyStatus: 'PASS' };
  }
  if (viewerId) {
    return {
      OR: [
        { safetyStatus: { in: ['PASS', 'UNCHECKED'] } },
        { safetyStatus: 'REVIEW', userId: viewerId },
      ],
    };
  }
  return { safetyStatus: { in: ['PASS', 'UNCHECKED'] } };
}

/** Reports use `reporterId` instead of `userId`. */
export function publicReportSafetyWhere(args: {
  surface: ContentSurface;
  viewerId?: string | null;
}): Prisma.ReportWhereInput {
  const viewerId = args.viewerId ?? undefined;
  if (args.surface === 'miniapp') {
    if (viewerId) {
      return {
        OR: [{ safetyStatus: 'PASS' }, { safetyStatus: 'REVIEW', reporterId: viewerId }],
      };
    }
    return { safetyStatus: 'PASS' };
  }
  if (viewerId) {
    return {
      OR: [
        { safetyStatus: { in: ['PASS', 'UNCHECKED'] } },
        { safetyStatus: 'REVIEW', reporterId: viewerId },
      ],
    };
  }
  return { safetyStatus: { in: ['PASS', 'UNCHECKED'] } };
}

export function isVisibleOnSurface(args: {
  surface: ContentSurface;
  status: ContentSafetyStatusName;
  authorId: string;
  viewerId?: string | null;
}): boolean {
  const { surface, status, authorId, viewerId } = args;
  if (status === 'RISKY') return false;
  if (status === 'PASS') return true;
  if (status === 'UNCHECKED') return surface !== 'miniapp';
  return viewerId === authorId;
}

export function publicSafetySql(args: {
  surface: ContentSurface;
  viewerId?: string | null;
  alias: string;
}): Prisma.Sql {
  const status = Prisma.raw(`"${args.alias}"."safetyStatus"`);
  const author = Prisma.raw(`"${args.alias}"."userId"`);
  const viewerId = args.viewerId ?? undefined;
  if (args.surface === 'miniapp') {
    if (viewerId) {
      return Prisma.sql`(${status} = 'PASS' OR (${status} = 'REVIEW' AND ${author} = ${viewerId}))`;
    }
    return Prisma.sql`${status} = 'PASS'`;
  }
  if (viewerId) {
    return Prisma.sql`(${status} IN ('PASS', 'UNCHECKED') OR (${status} = 'REVIEW' AND ${author} = ${viewerId}))`;
  }
  return Prisma.sql`${status} IN ('PASS', 'UNCHECKED')`;
}

/**
 * Keep the stricter of the previous row status and this write's decision.
 * REVIEW/RISKY must not fall through to UNCHECKED or PASS when an edit
 * cannot be re-checked (no credentials / no openid); that would publish
 * previously held content on the web list. UNCHECKED may be promoted to
 * PASS after a real check (spec: 补检通过). PASS may fall back to
 * UNCHECKED when this edit could not be checked.
 */
export function mergeSafetyStatus(
  previous: ContentSafetyStatusName | undefined,
  next: ContentSafetyStatusName,
): ContentSafetyStatusName {
  if (previous === 'RISKY') return 'RISKY';
  if (next === 'RISKY') return 'RISKY';
  if (previous === 'REVIEW') return 'REVIEW';
  return next;
}
