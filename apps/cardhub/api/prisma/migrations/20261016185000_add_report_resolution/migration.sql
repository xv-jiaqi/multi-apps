-- AlterTable
ALTER TABLE "reports" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "reports" ADD COLUMN "resolvedById" TEXT;
ALTER TABLE "reports" ADD COLUMN "resolution" TEXT;

-- CreateIndex
CREATE INDEX "reports_resolvedById_idx" ON "reports"("resolvedById");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
