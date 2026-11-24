import { randomBytes } from 'node:crypto';
import { CARD_NUMBER_MAX } from '@repo/shared';

const PREFIX = 'qa-';
const RANDOM_HEX_LEN = 12;

/** Unique e2e card number: `qa-` plus random hex, within CARD_NUMBER_MAX. */
export function qaCardNumber(): string {
  const value = `${PREFIX}${randomBytes(RANDOM_HEX_LEN / 2).toString('hex')}`;
  if (value.length > CARD_NUMBER_MAX) {
    throw new Error(`qaCardNumber exceeded CARD_NUMBER_MAX (${CARD_NUMBER_MAX})`);
  }
  return value;
}
