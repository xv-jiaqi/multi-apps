-- Expand-only long description.
-- Adds one nullable text column. It does not rename, drop, or tighten
-- any existing column, and it does not backfill. Old servers ignore body.
-- Rolling back the app to the previous image leaves this column in place.

ALTER TABLE "cards" ADD COLUMN "body" TEXT;
