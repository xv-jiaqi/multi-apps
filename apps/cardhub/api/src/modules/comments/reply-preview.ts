import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { PrismaService } from '../prisma/prisma.service';
import type { ContentSurface } from '@repo/shared';
import { publicSafetySql } from '../content-security/visibility';

/** How many replies the card/series list shows under each top-level comment. */
export const REPLY_PREVIEW_LIMIT = 3;

const replyPreviewSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  createdAt: z.coerce.date(),
  parentId: z.string().uuid(),
  userId: z.string().uuid(),
  username: z.string().min(1),
  safetyStatus: z.enum(['UNCHECKED', 'REVIEW', 'PASS', 'RISKY']),
});

export type ReplyPreview = z.infer<typeof replyPreviewSchema>;

/**
 * Oldest `REPLY_PREVIEW_LIMIT` replies for each parent. The lateral `LIMIT`
 * stops after that many rows per parent (the `(parentId, createdAt, id)` index
 * supports the order), instead of loading every reply into the API process.
 */
export function replyPreviewSql(
  parentIds: readonly string[],
  visibility: { surface: ContentSurface; viewerId?: string | null },
) {
  const safety = publicSafetySql({
    surface: visibility.surface,
    viewerId: visibility.viewerId,
    alias: 'comments',
  });
  return Prisma.sql`
    SELECT
      reply.id,
      reply.content,
      reply."createdAt" AS "createdAt",
      reply."parentId" AS "parentId",
      usr.id AS "userId",
      usr.username,
      reply."safetyStatus" AS "safetyStatus"
    FROM unnest(ARRAY[${Prisma.join(parentIds)}]::text[]) AS parent(id)
    JOIN LATERAL (
      SELECT id, content, "createdAt", "userId", "parentId", "safetyStatus"
      FROM comments
      WHERE "parentId" = parent.id
        AND ${safety}
      ORDER BY "createdAt" ASC, id ASC
      LIMIT ${REPLY_PREVIEW_LIMIT}
    ) AS reply ON TRUE
    JOIN users AS usr ON usr.id = reply."userId"
    ORDER BY reply."createdAt" ASC, reply.id ASC
  `;
}

export async function loadReplyPreviews(
  prisma: PrismaService,
  parentIds: readonly string[],
  visibility: { surface: ContentSurface; viewerId?: string | null },
): Promise<ReplyPreview[]> {
  if (parentIds.length === 0) return [];
  const rows = await prisma.$queryRaw(replyPreviewSql(parentIds, visibility));
  return z.array(replyPreviewSchema).parse(rows);
}
