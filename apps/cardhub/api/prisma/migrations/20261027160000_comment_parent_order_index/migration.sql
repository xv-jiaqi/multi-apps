-- Expand-only. Lets the per-parent reply preview stop after 3 rows.
-- Rollback: DROP INDEX "comments_parentId_createdAt_id_idx";
CREATE INDEX "comments_parentId_createdAt_id_idx" ON "comments"("parentId", "createdAt", "id");
