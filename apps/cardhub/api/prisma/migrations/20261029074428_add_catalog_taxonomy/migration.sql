-- Expand-only catalog taxonomy. Old servers ignore the new tables and columns.
-- Deleting a category sets series.categoryId to null. Deleting a subset sets
-- cards.subsetId to null. Deleting a series cascades to its subsets.
-- CreateEnum
CREATE TYPE "SubsetKind" AS ENUM ('BASE', 'INSERT');

-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "cardNumber" TEXT,
ADD COLUMN     "subsetId" TEXT;

-- AlterTable
ALTER TABLE "series" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "releaseDate" DATE;

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subsets" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SubsetKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subsets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_sortOrder_name_idx" ON "categories"("sortOrder", "name");

-- CreateIndex
CREATE INDEX "subsets_seriesId_sortOrder_idx" ON "subsets"("seriesId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "subsets_seriesId_slug_key" ON "subsets"("seriesId", "slug");

-- CreateIndex
CREATE INDEX "cards_subsetId_idx" ON "cards"("subsetId");

-- CreateIndex
CREATE INDEX "series_categoryId_idx" ON "series"("categoryId");

-- CreateIndex
CREATE INDEX "series_releaseDate_idx" ON "series"("releaseDate");

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subsets" ADD CONSTRAINT "subsets_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_subsetId_fkey" FOREIGN KEY ("subsetId") REFERENCES "subsets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
