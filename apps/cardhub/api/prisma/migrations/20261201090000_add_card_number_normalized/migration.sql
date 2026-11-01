-- Expand-only card-number key for /search c:.
-- Independent of add_release_calendar: this migration does not create or
-- alter the release calendar. Its timestamp is later so migrate deploy runs
-- it after that migration. Old servers ignore the new column.
-- The backfill matches normalizedCardNumber in @repo/shared. Later writes
-- set cardNumberNormalized in the same statement as cardNumber.

CREATE OR REPLACE FUNCTION cardhub_card_number_normalized(input text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw text;
  digits text;
  head text;
  stripped text;
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;
  raw := btrim(input);
  IF raw = '' THEN
    RETURN NULL;
  END IF;
  IF left(raw, 1) = '#' THEN
    raw := btrim(substr(raw, 2));
    IF raw = '' THEN
      RETURN NULL;
    END IF;
  END IF;
  raw := lower(raw);
  IF raw !~ '[0-9]$' THEN
    RETURN raw;
  END IF;
  digits := substring(raw from '([0-9]+)$');
  IF digits IS NULL THEN
    RETURN raw;
  END IF;
  head := left(raw, length(raw) - length(digits));
  stripped := regexp_replace(digits, '^0+', '');
  IF stripped = '' THEN
    stripped := '0';
  END IF;
  RETURN head || stripped;
END;
$$;

ALTER TABLE "cards" ADD COLUMN "cardNumberNormalized" TEXT;

UPDATE "cards"
SET "cardNumberNormalized" = cardhub_card_number_normalized("cardNumber")
WHERE "cardNumber" IS NOT NULL;

CREATE INDEX "cards_cardNumberNormalized_idx" ON "cards"("cardNumberNormalized");
