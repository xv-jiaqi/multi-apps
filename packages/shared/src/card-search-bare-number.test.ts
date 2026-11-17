import { describe, expect, it } from 'vitest';
import { CARD_NUMBER_MAX } from './zod';
import {
  bareCardNumberTerm,
  parseCardSearchQuery,
  relevanceSearchTerm,
  type CardSearchParseResult,
} from './utils';

type ParsedOk = Extract<CardSearchParseResult, { ok: true }>;

function parsedOk(query: string): ParsedOk {
  const parsed = parseCardSearchQuery(query);
  if (!parsed.ok) throw new Error(`expected ok parse for ${query}`);
  return parsed;
}

describe('bareCardNumberTerm (CH-241 §2)', () => {
  it.each([
    ['025', '25'],
    ['7', '7'],
    ['000', '0'],
    ['25-07', '25-7'],
    ['025/165', '025/165'],
  ])('treats bare %s as a card number with key %s', (term, key) => {
    expect(bareCardNumberTerm(term)).toBe(key);
  });

  it.each([
    'B',
    'DAR',
    'ex',
    'A05',
    'SV007',
    '7a',
    '皮卡丘',
    '25-',
    '-25',
    '25--07',
    '25-07-1',
    '25/',
    '#025',
    '25 07',
    '',
  ])('leaves %s to name matching only', (term) => {
    expect(bareCardNumberTerm(term)).toBeNull();
  });

  it('skips a numeric term longer than a card number can be', () => {
    expect(bareCardNumberTerm('1'.repeat(CARD_NUMBER_MAX))).toBe('1'.repeat(CARD_NUMBER_MAX));
    expect(bareCardNumberTerm('1'.repeat(CARD_NUMBER_MAX + 1))).toBeNull();
  });

  it('keeps the parse result shape: bare numbers stay name terms, c: is unchanged', () => {
    expect(parseCardSearchQuery('025')).toEqual({
      ok: true,
      includeGroups: [['025']],
      excludeTerms: [],
    });
    expect(parseCardSearchQuery('25-07')).toEqual({
      ok: true,
      includeGroups: [['25-07']],
      excludeTerms: [],
    });
    expect(parseCardSearchQuery('025 s:ptcg-sc-151')).toEqual({
      ok: true,
      seriesSlug: 'ptcg-sc-151',
      includeGroups: [['025']],
      excludeTerms: [],
    });
    expect(parseCardSearchQuery('c:025')).toEqual({
      ok: true,
      cardNumber: '25',
      includeGroups: [],
      excludeTerms: [],
    });
  });

  it('gives bare 025 and c:025 the same card-number key', () => {
    expect(bareCardNumberTerm(parsedOk('025').includeGroups[0]![0]!)).toBe(
      parsedOk('c:025').cardNumber,
    );
    expect(bareCardNumberTerm(parsedOk('25-07').includeGroups[0]![0]!)).toBe(
      parsedOk('c:25-07').cardNumber,
    );
  });
});

describe('relevanceSearchTerm (CH-241 §1)', () => {
  it('uses the first positive bare word across AND and OR groups', () => {
    expect(relevanceSearchTerm(parsedOk('皮卡丘'))).toBe('皮卡丘');
    expect(relevanceSearchTerm(parsedOk('皮卡丘 OR 喷火龙'))).toBe('皮卡丘');
    expect(relevanceSearchTerm(parsedOk('-皮卡丘 ex'))).toBe('ex');
    expect(relevanceSearchTerm(parsedOk('s:ptcg-sc-151 皮卡丘 ex'))).toBe('皮卡丘');
  });

  it('is undefined without a positive bare word', () => {
    expect(relevanceSearchTerm(parsedOk('c:025'))).toBeUndefined();
    expect(relevanceSearchTerm(parsedOk('-皮卡丘'))).toBeUndefined();
    expect(relevanceSearchTerm(parsedOk('r:rare s:ptcg-sc-151'))).toBeUndefined();
  });
});
