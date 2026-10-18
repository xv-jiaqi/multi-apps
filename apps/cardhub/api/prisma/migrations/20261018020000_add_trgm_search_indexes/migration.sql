-- CH-106 / AC1-1. cards.name and series.title are searched with ILIKE '%q%'.
-- The btree index on cards.name cannot accelerate a leading wildcard.
--
-- staging and prod are postgres:16-alpine. The cardhub role is a superuser,
-- so CREATE EXTENSION is allowed. pg_trgm 1.6 is available and not installed
-- yet. Production currently has 9 cards and 3 series, so a regular CREATE
-- INDEX finishes in milliseconds. CREATE INDEX CONCURRENTLY cannot run inside
-- Prisma's migration transaction, and it is unnecessary at this size.
-- IF NOT EXISTS keeps a re-run safe on a database that already has the objects.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cards_name_trgm_idx" ON "cards" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "series_title_trgm_idx" ON "series" USING GIN ("title" gin_trgm_ops);
