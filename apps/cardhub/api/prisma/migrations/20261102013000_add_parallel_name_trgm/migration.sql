-- Expand-only trigram index for /search ILIKE on parallelName.
-- Folder timestamp 20261102013000 sorts after
-- 20261102003000_add_card_parallels, which adds the nullable column.
-- A leading-wildcard match cannot use a btree index. This is the same
-- gin_trgm index cards.name already has. Old servers ignore it.
-- pg_trgm is created by 20261018020000_add_trgm_search_indexes.

CREATE INDEX IF NOT EXISTS "cards_parallelName_trgm_idx"
  ON "cards" USING GIN ("parallelName" gin_trgm_ops);
