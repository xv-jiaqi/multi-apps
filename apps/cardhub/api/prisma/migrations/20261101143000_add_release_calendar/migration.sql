-- Expand-only release calendar. Old servers ignore this table.
-- Deleting a series or category sets the foreign key to null and does not
-- block the old server's delete. Roll the app back and leave the table.
-- Dropping it has to be a later forward migration.
-- CreateEnum
CREATE TYPE "ReleaseRegion" AS ENUM ('CN', 'JP', 'GLOBAL');

-- CreateEnum
CREATE TYPE "ReleaseDatePrecision" AS ENUM ('DAY', 'MONTH');

-- CreateTable
CREATE TABLE "releases" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "releaseDate" DATE NOT NULL,
    "datePrecision" "ReleaseDatePrecision" NOT NULL DEFAULT 'DAY',
    "region" "ReleaseRegion",
    "seriesId" TEXT,
    "categoryId" TEXT,
    "note" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "releases_releaseDate_id_idx" ON "releases"("releaseDate", "id");

-- CreateIndex
CREATE INDEX "releases_categoryId_releaseDate_id_idx" ON "releases"("categoryId", "releaseDate", "id");

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
