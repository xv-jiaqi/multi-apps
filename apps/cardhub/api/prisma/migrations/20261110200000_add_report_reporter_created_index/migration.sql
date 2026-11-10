-- CH-230 230-B. Expand-only: one btree index for the reports daily quota
-- count (reporterId = ? AND createdAt >= ?) and its oldest-row read. It does
-- not change any column or row. Old servers ignore it, so rolling the app
-- back to 512f8fb needs no database change.
--
-- Plain CREATE INDEX, not CONCURRENTLY: on 2026-11-10 20:17 (UTC+8) reports
-- had 54 rows on staging and 1 on prod, so the write lock lasts milliseconds.
-- Prisma migrate deploy runs a migration file as one implicit transaction
-- (verified on Postgres 16 with Prisma 6.19.3). CONCURRENTLY would only work
-- as the single statement of its own file. Use that form once the table is
-- large (> 100k rows).
-- IF NOT EXISTS keeps a re-run safe on a database that already has it.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reports_reporterId_createdAt_idx" ON "reports"("reporterId", "createdAt");
