import { describe, expect, it } from 'vitest';
import { CARD_NUMBER_MAX } from './zod';
import {
  cardSearchHint,
  hasCardSearchConditions,
  parseCardSearchQuery,
  shouldRequestCardSearchQuery,
} from './utils';

describe('parseCardSearchQuery c: and y:', () => {
  it('normalizes c: and keeps the first repeated prefix', () => {
    expect(parseCardSearchQuery('c:7')).toEqual({
      ok: true,
      cardNumber: '7',
      includeGroups: [],
      excludeTerms: [],
    });
    expect(parseCardSearchQuery('c:007')).toMatchObject({ cardNumber: '7' });
    expect(parseCardSearchQuery('c:#7')).toMatchObject({ cardNumber: '7' });
    expect(parseCardSearchQuery('C:A05')).toMatchObject({ cardNumber: 'a5' });
    const repeated = parseCardSearchQuery('c:1 c:2');
    expect(repeated).toMatchObject({ ok: true, cardNumber: '1' });
    expect(repeated.ok && repeated.ignored).toBeUndefined();
  });

  it('accepts a 4-digit year including 0000, 0999, and 9999', () => {
    expect(parseCardSearchQuery('y:2024')).toMatchObject({ ok: true, releaseYear: 2024 });
    expect(parseCardSearchQuery('y:0000')).toMatchObject({ ok: true, releaseYear: 0 });
    expect(parseCardSearchQuery('y:0999')).toMatchObject({ ok: true, releaseYear: 999 });
    expect(parseCardSearchQuery('y:9999')).toMatchObject({ ok: true, releaseYear: 9999 });
    expect(parseCardSearchQuery('Y:2024')).toMatchObject({ releaseYear: 2024 });
  });

  it('ignores an invalid year or an overlong card number and keeps the rest', () => {
    const year = parseCardSearchQuery('y:abc r:rare 龙');
    expect(year).toMatchObject({
      ok: true,
      rarity: 'rare',
      includeGroups: [['龙']],
      ignored: { reason: 'invalidYear', token: 'y:abc' },
    });
    expect(parseCardSearchQuery('y:20')).toMatchObject({
      ok: true,
      ignored: { reason: 'invalidYear', token: 'y:20' },
    });
    expect(parseCardSearchQuery('y:02024')).toMatchObject({
      ok: true,
      ignored: { reason: 'invalidYear', token: 'y:02024' },
    });
    const tooLong = `c:${'N'.repeat(CARD_NUMBER_MAX + 1)} 龙`;
    const parsed = parseCardSearchQuery(tooLong);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.cardNumber).toBeUndefined();
    expect(parsed.ignored).toEqual({
      reason: 'cardNumberTooLong',
      token: `c:${'N'.repeat(CARD_NUMBER_MAX + 1)}`,
    });
    expect(parsed.includeGroups).toEqual([['龙']]);
    expect(`c:${'N'.repeat(CARD_NUMBER_MAX)}`).toHaveLength(CARD_NUMBER_MAX + 2);
    expect(parseCardSearchQuery(`c:${'A'.repeat(CARD_NUMBER_MAX)}`).ok).toBe(true);
  });

  it('counts the card-number limit after trim and shows only the first ignored token', () => {
    const padded = `c:${`${' '.repeat(3)}${'B'.repeat(CARD_NUMBER_MAX + 1)}`}`;
    // Tokens are split on whitespace, so the value itself has no padding.
    // A value that is exactly the limit after trim is kept.
    expect(parseCardSearchQuery(`c:${'Z'.repeat(CARD_NUMBER_MAX)}`)).toMatchObject({
      ok: true,
      cardNumber: 'z'.repeat(CARD_NUMBER_MAX),
    });
    expect(padded.startsWith('c:')).toBe(true);

    const both = parseCardSearchQuery('y:abc c:' + 'Q'.repeat(CARD_NUMBER_MAX + 1));
    expect(both.ok && both.ignored).toEqual({ reason: 'invalidYear', token: 'y:abc' });
    const laterInvalid = parseCardSearchQuery('c:7 y:nope');
    expect(laterInvalid).toMatchObject({
      ok: true,
      cardNumber: '7',
      ignored: { reason: 'invalidYear', token: 'y:nope' },
    });
    const repeatedYear = parseCardSearchQuery('y:2024 y:1999');
    expect(repeatedYear).toMatchObject({ ok: true, releaseYear: 2024 });
    expect(repeatedYear.ok && repeatedYear.ignored).toBeUndefined();
  });

  it('treats an empty prefix as silent and ANDs prefixes with free text', () => {
    expect(parseCardSearchQuery('c: y: 龙')).toEqual({
      ok: true,
      includeGroups: [['龙']],
      excludeTerms: [],
    });
    expect(parseCardSearchQuery('c: 7')).toEqual({
      ok: true,
      includeGroups: [['7']],
      excludeTerms: [],
    });
    expect(parseCardSearchQuery('y:2024 r:rare c:A05 龙 OR 凤')).toMatchObject({
      ok: true,
      rarity: 'rare',
      cardNumber: 'a5',
      releaseYear: 2024,
      includeGroups: [['龙'], ['凤']],
    });
    expect(shouldRequestCardSearchQuery('c:7')).toBe(true);
    expect(shouldRequestCardSearchQuery('y:2024')).toBe(true);
    expect(shouldRequestCardSearchQuery('y:0000')).toBe(true);
    expect(shouldRequestCardSearchQuery('y:abc')).toBe(false);
    expect(shouldRequestCardSearchQuery('y:abc 龙')).toBe(true);
    expect(shouldRequestCardSearchQuery('c:')).toBe(false);
    const ignoredOnly = parseCardSearchQuery('y:abc');
    expect(ignoredOnly.ok).toBe(true);
    if (!ignoredOnly.ok) return;
    expect(hasCardSearchConditions(ignoredOnly)).toBe(false);
    expect(cardSearchHint(ignoredOnly)).toEqual({ reason: 'invalidYear', token: 'y:abc' });
  });

  it('still rejects unknown prefixes and invalid rarity', () => {
    expect(parseCardSearchQuery('z:1')).toEqual({
      ok: false,
      reason: 'unknownPrefix',
      token: 'z:1',
    });
    expect(cardSearchHint(parseCardSearchQuery('r:mythic'))).toEqual({
      reason: 'invalidRarity',
      token: 'r:mythic',
    });
  });
});
