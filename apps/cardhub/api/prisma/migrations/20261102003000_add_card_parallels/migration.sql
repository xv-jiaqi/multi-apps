-- Expand-only parallel-version columns.
-- Folder timestamp 20261102003000 sorts after
-- 20261101160000_add_notifications.
-- Adds nullable columns, one index, one self-FK, and a BEFORE UPDATE
-- trigger. It does not rename, drop, or tighten any existing column.
-- Old servers ignore parallelOfId, parallelName, and printRun.
-- Deleting a base card sets parallelOfId to null (ON DELETE SET NULL)
-- and leaves parallelName. A series change clears a link only when the
-- base and the parallel are not in the same series afterwards. One UPDATE
-- that moves both into the same series keeps the link. parallelName stays.
-- The BEFORE trigger only assigns NEW.parallelOfId. It does not UPDATE
-- other rows: doing that inside the same command raises SQLSTATE 27000.
-- Children are cleared by the AFTER STATEMENT trigger, which runs after
-- the command has finished. pg_trigger_depth() stops that follow-up UPDATE
-- from entering the statement trigger again.

ALTER TABLE "cards" ADD COLUMN "parallelOfId" TEXT;
ALTER TABLE "cards" ADD COLUMN "parallelName" TEXT;
ALTER TABLE "cards" ADD COLUMN "printRun" INTEGER;

CREATE INDEX "cards_parallelOfId_idx" ON "cards"("parallelOfId");

ALTER TABLE "cards" ADD CONSTRAINT "cards_parallelOfId_fkey"
  FOREIGN KEY ("parallelOfId") REFERENCES "cards"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION cardhub_cards_parallel_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."seriesId" IS DISTINCT FROM OLD."seriesId"
     AND NEW."parallelOfId" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM "cards" AS base
       WHERE base."id" = NEW."parallelOfId"
         AND base."seriesId" IS NOT DISTINCT FROM NEW."seriesId"
     ) THEN
    NEW."parallelOfId" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cardhub_cards_parallel_after()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM new_rows AS moved
    JOIN old_rows AS prev ON prev.id = moved.id
    WHERE prev."seriesId" IS DISTINCT FROM moved."seriesId"
  ) THEN
    RETURN NULL;
  END IF;

  -- The BEFORE trigger cannot see a base moved by this same command, so it
  -- may clear a link that still belongs together. Put that link back.
  UPDATE "cards" AS child
  SET "parallelOfId" = prev."parallelOfId"
  FROM new_rows AS moved
  JOIN old_rows AS prev ON prev.id = moved.id
  JOIN "cards" AS base ON base.id = prev."parallelOfId"
  WHERE child.id = moved.id
    AND prev."parallelOfId" IS NOT NULL
    AND base."seriesId" IS NOT DISTINCT FROM child."seriesId"
    AND child."parallelOfId" IS DISTINCT FROM prev."parallelOfId";

  UPDATE "cards" AS child
  SET "parallelOfId" = NULL
  FROM new_rows AS moved
  JOIN old_rows AS prev ON prev.id = moved.id
  WHERE prev."seriesId" IS DISTINCT FROM moved."seriesId"
    AND (child.id = moved.id OR child."parallelOfId" = moved.id)
    AND child."parallelOfId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "cards" AS base
      WHERE base.id = child."parallelOfId"
        AND base."seriesId" IS NOT DISTINCT FROM child."seriesId"
    );

  RETURN NULL;
END;
$$;

CREATE TRIGGER cards_parallel_row
BEFORE UPDATE ON "cards"
FOR EACH ROW
EXECUTE FUNCTION cardhub_cards_parallel_row();

CREATE TRIGGER cards_parallel_after
AFTER UPDATE ON "cards"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION cardhub_cards_parallel_after();
