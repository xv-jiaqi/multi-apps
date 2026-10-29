-- Expand-only. One row per user per UTC calendar day for product metrics.
-- Old servers ignore this table. No IP, user agent, or profile columns.
-- CreateTable
CREATE TABLE "user_daily_activities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_daily_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_daily_activities_day_idx" ON "user_daily_activities"("day");

-- CreateIndex
CREATE UNIQUE INDEX "user_daily_activities_userId_day_key" ON "user_daily_activities"("userId", "day");

-- AddForeignKey
ALTER TABLE "user_daily_activities" ADD CONSTRAINT "user_daily_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
