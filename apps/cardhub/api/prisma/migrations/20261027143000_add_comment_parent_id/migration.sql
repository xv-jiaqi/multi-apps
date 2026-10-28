-- Expand-only: one-level comment replies. Null parentId is a top-level comment.
-- Old servers ignore the column. Deleting a parent cascades its replies.
ALTER TABLE "comments" ADD COLUMN "parentId" TEXT;

CREATE INDEX "comments_parentId_idx" ON "comments"("parentId");

ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
