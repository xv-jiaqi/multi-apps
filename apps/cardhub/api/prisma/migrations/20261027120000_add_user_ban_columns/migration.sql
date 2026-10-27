-- Expand-only. Previous application builds ignore the new nullable columns.
ALTER TABLE "users" ADD COLUMN "bannedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "bannedById" TEXT;

CREATE INDEX "users_bannedAt_idx" ON "users"("bannedAt");

ALTER TABLE "users" ADD CONSTRAINT "users_bannedById_fkey" FOREIGN KEY ("bannedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
