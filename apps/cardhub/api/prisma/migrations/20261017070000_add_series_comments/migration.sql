-- Add optional series comments while preserving existing card comments.
ALTER TABLE "comments" ADD COLUMN "seriesId" TEXT;
ALTER TABLE "comments" ALTER COLUMN "cardId" DROP NOT NULL;

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "series"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A comment belongs to exactly one target: either a card or a series.
ALTER TABLE "comments"
  ADD CONSTRAINT "comments_exactly_one_target_check"
  CHECK (num_nonnulls("cardId", "seriesId") = 1);

CREATE INDEX "comments_seriesId_idx" ON "comments"("seriesId");
