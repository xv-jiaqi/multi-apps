-- CH-103: editedAt is intentionally nullable and not backfilled.
ALTER TABLE "topics" ADD COLUMN "editedAt" TIMESTAMP(3);

CREATE INDEX "topics_pinned_createdAt_id_idx" ON "topics"("pinned", "createdAt", "id");
