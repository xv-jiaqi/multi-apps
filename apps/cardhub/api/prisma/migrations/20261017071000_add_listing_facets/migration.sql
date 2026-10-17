CREATE TYPE "ListingCondition" AS ENUM (
  'NEAR_MINT',
  'LIGHTLY_PLAYED',
  'MODERATELY_PLAYED',
  'HEAVILY_PLAYED',
  'DAMAGED'
);

CREATE TYPE "ListingLanguage" AS ENUM ('ZH', 'EN', 'JA', 'OTHER');

ALTER TABLE "listings"
  ADD COLUMN "condition" "ListingCondition",
  ADD COLUMN "language" "ListingLanguage",
  ADD COLUMN "variantNote" TEXT;

CREATE INDEX "listings_status_currency_price_idx" ON "listings"("status", "currency", "price");
