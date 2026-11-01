-- Expand-only card-number key for /search c:.
-- Folder timestamp 20261101150000 sorts after
-- 20261101143000_add_release_calendar and before
-- 20261101160000_add_notifications. This file does not create or alter
-- releases or notifications. Old servers ignore the new column.
-- The backfill and the trigger both call cardhub_card_number_normalized,
-- which matches normalizedCardNumber in @repo/shared. The trigger runs on
-- every insert and update, so a server that does not write this column
-- (including a rollback to the previous image) still leaves a current key.
-- The application writes the same key in the same statement.

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

CREATE OR REPLACE FUNCTION cardhub_cards_sync_card_number_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."cardNumberNormalized" := cardhub_card_number_normalized(NEW."cardNumber");
  RETURN NEW;
END;
$$;

CREATE TRIGGER cards_sync_card_number_normalized
BEFORE INSERT OR UPDATE ON "cards"
FOR EACH ROW
EXECUTE FUNCTION cardhub_cards_sync_card_number_normalized();
