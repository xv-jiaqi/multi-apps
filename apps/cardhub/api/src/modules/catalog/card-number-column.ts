import { normalizedCardNumber } from '@repo/shared';

/** Keep the indexed `c:` key in step with the printed number. */
export function cardNumberColumns(cardNumber: string | null): {
  cardNumber: string | null;
  cardNumberNormalized: string | null;
} {
  return {
    cardNumber,
    cardNumberNormalized: normalizedCardNumber(cardNumber),
  };
}
