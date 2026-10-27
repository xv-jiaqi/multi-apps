import type { Prisma } from '@prisma/client';

export const CONTENT_DELETE_ACTION = 'CONTENT_DELETE';
export const USER_BAN_ACTION = 'USER_BAN';
export const USER_UNBAN_ACTION = 'USER_UNBAN';
export const REPORT_RESOLVE_ACTION = 'REPORT_RESOLVE';
const TARGET_LABEL_MAX = 80;

export type ContentDeleteTargetType = 'TOPIC' | 'REPLY' | 'COMMENT' | 'LISTING' | 'CARD' | 'SERIES';

/** Empty or whitespace-only reasons are stored as null so the audit UI can show 「未填写」. */
export function normalizeDeleteReason(reason: string | undefined): string | null {
  const trimmed = reason?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed;
}

export function contentSnapshot(value: string): string {
  const trimmed = value.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= TARGET_LABEL_MAX) return trimmed;
  return chars.slice(0, TARGET_LABEL_MAX).join('');
}

export async function writeContentDelete(
  tx: Prisma.TransactionClient,
  entry: {
    actorId: string;
    actorUsername: string;
    targetType: ContentDeleteTargetType;
    targetId: string;
    targetLabel: string;
    targetUserId: string | null;
    reason: string | null;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      actorUsername: entry.actorUsername,
      action: CONTENT_DELETE_ACTION,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetLabel: contentSnapshot(entry.targetLabel),
      targetUserId: entry.targetUserId,
      reason: entry.reason,
    },
  });
}

export async function writeReportResolve(
  tx: Prisma.TransactionClient,
  entry: {
    actorId: string;
    actorUsername: string;
    targetId: string;
    targetLabel: string;
    targetUserId: string | null;
    reason: string | null;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      actorUsername: entry.actorUsername,
      action: REPORT_RESOLVE_ACTION,
      targetType: 'REPORT',
      targetId: entry.targetId,
      targetLabel: contentSnapshot(entry.targetLabel),
      targetUserId: entry.targetUserId,
      reason: entry.reason,
    },
  });
}
