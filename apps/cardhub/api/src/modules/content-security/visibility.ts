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

/**
 * Which surface's visibility rules apply. An explicit `input.surface` wins,
 * then the `x-cardhub-surface` header (parsed in the tRPC context), then
 * `web`. Web and native send neither, so their default is unchanged.
 */
export function resolveContentSurface(
  surface: ContentSurface | undefined,
  headerSurface?: ContentSurface,
): ContentSurface {
  return surface ?? headerSurface ?? 'web';
}

export function toSafetyStatusDto(
  status: ContentSafetyStatusName,
): Exclude<ContentSafetyResultName, 'pending'> {
  if (status === 'UNCHECKED') return 'unchecked';
  if (status === 'REVIEW') return 'review';
  if (status === 'PASS') return 'pass';
  return 'risky';
}

export type SafetyStatusDto = Exclude<ContentSafetyResultName, 'pending'>;

/**
 * Status DTO for responses that may carry an author's own blocked row.
 * `'risky'` stays in the union so existing clients keep type-checking
 * (contract is add-only); author views send `'blocked'` instead.
 */
export type AuthorSafetyStatusDto = SafetyStatusDto | 'blocked';

/** Widen a visible row's status to the author-view union. */
export function authorSafetyStatus(status: SafetyStatusDto): AuthorSafetyStatusDto {
  return status;
}

/** Status for the author's own RISKY row. */
export function blockedSafetyStatus(): AuthorSafetyStatusDto {
  return 'blocked';
}

/** Signed-in viewer who wrote the row. Missing or empty ids never match. */
function isAuthorViewer(args: { authorId: string; viewerId?: string | null }): boolean {
  return (
    typeof args.viewerId === 'string' && args.viewerId.length > 0 && args.viewerId === args.authorId
  );
}

/**
 * What one viewer may see of one row:
 * - `hidden`: treat as missing (NOT_FOUND / left out of the list);
 * - `blocked`: the signed-in author's own RISKY row; send the status only,
 *   never the original text;
 * - `visible`: send the row with its status.
 *
 * `public` reads follow the surface rules (`isVisibleOnSurface`), plus the
 * author's own blocked row. `owner` reads ("my" lists) show every row to its
 * author and nothing to anyone else. Both are fail-closed: no viewer id, or a
 * viewer id that is not the author, never reaches REVIEW or RISKY rows.
 */
export type SafetyView =
  | { kind: 'hidden' }
  | { kind: 'blocked' }
  | { kind: 'visible'; safetyStatus: SafetyStatusDto };

export function resolveSafetyView(
  args: {
    status: ContentSafetyStatusName;
    authorId: string;
    viewerId?: string | null;
  } & ({ scope: 'owner' } | { scope: 'public'; surface: ContentSurface }),
): SafetyView {
  const isAuthor = isAuthorViewer({ authorId: args.authorId, viewerId: args.viewerId });
  if (args.status === 'RISKY') return isAuthor ? { kind: 'blocked' } : { kind: 'hidden' };
  if (args.scope === 'owner') {
    return isAuthor
      ? { kind: 'visible', safetyStatus: toSafetyStatusDto(args.status) }
      : { kind: 'hidden' };
  }
  return isVisibleOnSurface({
    surface: args.surface,
    status: args.status,
    authorId: args.authorId,
    viewerId: args.viewerId,
  })
    ? { kind: 'visible', safetyStatus: toSafetyStatusDto(args.status) }
    : { kind: 'hidden' };
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
  return isAuthorViewer({ authorId, viewerId });
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
