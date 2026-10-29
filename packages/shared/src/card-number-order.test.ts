import { describe, expect, it } from 'vitest';
import { compareCardNumbers } from './card-number-order';

const NUMBER_ORDER = [
  '001',
  '1',
  'TG01',
  '2',
  '2/165',
  'A2',
  '2a',
  '2b',
  '4',
  '10',
  'A10',
  'SV10a',
  'TG10',
  '12/165',
  '99',
  'PROMO',
  null,
  '',
  '   ',
] as const;

describe('compareCardNumbers', () => {
  it('orders the integer first, then the prefix and suffix, and puts blanks last', () => {
    const shuffled = [...NUMBER_ORDER].reverse();
    const sorted = shuffled.sort((left, right) => compareCardNumbers(left, right));
    expect(sorted.slice(0, NUMBER_ORDER.indexOf('PROMO') + 1)).toEqual([
      '001',
      '1',
      'TG01',
      '2',
      '2/165',
      'A2',
      '2a',
      '2b',
      '4',
      '10',
      'A10',
      'SV10a',
      'TG10',
      '12/165',
      '99',
      'PROMO',
    ]);
    expect(sorted.slice(NUMBER_ORDER.indexOf('PROMO') + 1).every((value) => !value?.trim())).toBe(
      true,
    );
  });

  it('keeps letter prefixes and suffixes in numeric order', () => {
    expect(compareCardNumbers('1', '2')).toBeLessThan(0);
    expect(compareCardNumbers('2', '10')).toBeLessThan(0);
    expect(compareCardNumbers('10', '2')).toBeGreaterThan(0);
    expect(compareCardNumbers('A2', 'A10')).toBeLessThan(0);
    expect(compareCardNumbers('SV2', 'SV10')).toBeLessThan(0);
    expect(compareCardNumbers('2a', '2b')).toBeLessThan(0);
    expect(compareCardNumbers('10a', '10b')).toBeLessThan(0);
    expect(compareCardNumbers('B2', 'A10')).toBeLessThan(0);
    expect(compareCardNumbers('  2  ', '10')).toBeLessThan(0);
  });

  it('treats leading zeros as the same integer and still orders a huge digit run', () => {
    expect(compareCardNumbers('001', '1')).toBeLessThan(0);
    expect(compareCardNumbers('099', '100')).toBeLessThan(0);
    const nines = '9'.repeat(40);
    const power = `1${'0'.repeat(40)}`;
    expect(compareCardNumbers(nines, power)).toBeLessThan(0);
    expect(compareCardNumbers(power, nines)).toBeGreaterThan(0);
  });
});
