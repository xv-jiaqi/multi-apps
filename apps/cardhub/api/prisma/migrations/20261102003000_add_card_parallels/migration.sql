-- Expand-only parallel-version columns.
-- Folder timestamp 20261102003000 sorts after
-- 20261101160000_add_notifications.
-- Adds nullable columns, one index, one self-FK, and a BEFORE UPDATE
-- trigger. It does not rename, drop, or tighten any existing column.
-- Old servers ignore parallelOfId, parallelName, and printRun.
-- Deleting a base card sets parallelOfId to null (ON DELETE SET NULL)
-- and leaves parallelName. The trigger does the same clear when seriesId
-- changes and the referenced card is not in the new series, and it clears
-- rows that pointed at the moved card. Those writes still succeed.

ALTER TABLE "cards" ADD COLUMN "parallelOfId" TEXT;
ALTER TABLE "cards" ADD COLUMN "parallelName" TEXT;
ALTER TABLE "cards" ADD COLUMN "printRun" INTEGER;

CREATE INDEX "cards_parallelOfId_idx" ON "cards"("parallelOfId");

ALTER TABLE "cards" ADD CONSTRAINT "cards_parallelOfId_fkey"
  FOREIGN KEY ("parallelOfId") REFERENCES "cards"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION cardhub_cards_parallel_same_series()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."seriesId" IS DISTINCT FROM OLD."seriesId" THEN
    UPDATE "cards"
    SET "parallelOfId" = NULL
    WHERE "parallelOfId" = NEW."id";

    IF NEW."parallelOfId" IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM "cards" AS base
      WHERE base."id" = NEW."parallelOfId"
        AND base."seriesId" IS NOT DISTINCT FROM NEW."seriesId"
    ) THEN
      NEW."parallelOfId" := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cards_parallel_same_series
BEFORE UPDATE ON "cards"
FOR EACH ROW
EXECUTE FUNCTION cardhub_cards_parallel_same_series();
