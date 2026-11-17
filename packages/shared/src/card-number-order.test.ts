import { describe, expect, it } from 'vitest';
import { compareCardNumbers, compareCardNumbersInSubsets } from './card-number-order';

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

type Placed = { id: string; cardNumber: string | null; subsetSortOrder: number | null };

function sortPlaced(rows: readonly Placed[]): string[] {
  return [...rows]
    .sort((left, right) => compareCardNumbersInSubsets({ left, right }))
    .map((row) => row.id);
}

describe('compareCardNumbersInSubsets', () => {
  it('orders cards without digits by subset sortOrder before the text compare', () => {
    const rows: Placed[] = [
      { id: 'GRA', cardNumber: 'GRA', subsetSortOrder: 3 },
      { id: 'R', cardNumber: 'R', subsetSortOrder: 2 },
      { id: 'DAR', cardNumber: 'DAR', subsetSortOrder: 3 },
      { id: 'G', cardNumber: 'G', subsetSortOrder: 2 },
      { id: 'B', cardNumber: 'B', subsetSortOrder: 2 },
      { id: '10', cardNumber: '010', subsetSortOrder: 1 },
      { id: '2', cardNumber: '002', subsetSortOrder: 0 },
    ];
    expect(sortPlaced(rows)).toEqual(['2', '10', 'B', 'G', 'R', 'DAR', 'GRA']);
  });

  it('keeps the text compare inside one subset', () => {
    const rows: Placed[] = ['WAT', 'FIG', 'MET', 'FIR'].map((value) => ({
      id: value,
      cardNumber: value,
      subsetSortOrder: 3,
    }));
    expect(sortPlaced(rows)).toEqual(['FIG', 'FIR', 'MET', 'WAT']);
  });

  it('puts text card numbers without a subset after those with one, before blanks', () => {
    const rows: Placed[] = [
      { id: 'blank', cardNumber: '  ', subsetSortOrder: 0 },
      { id: 'A-none', cardNumber: 'A', subsetSortOrder: null },
      { id: 'Z-high', cardNumber: 'Z', subsetSortOrder: 99 },
      { id: 'PROMO-none', cardNumber: 'PROMO', subsetSortOrder: null },
      { id: 'M-low', cardNumber: 'M', subsetSortOrder: 0 },
      { id: '1-none', cardNumber: '1', subsetSortOrder: null },
    ];
    expect(sortPlaced(rows)).toEqual([
      '1-none',
      'M-low',
      'Z-high',
      'A-none',
      'PROMO-none',
      'blank',
    ]);
  });

  it('matches compareCardNumbers whenever no card number lacks digits', () => {
    // Deterministic LCG so a failure is reproducible.
    let state = 0x2377;
    const next = (limit: number) => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % limit;
    };
    const shapes = [
      (n: number) => String(n).padStart(3, '0'),
      (n: number) => String(n),
      (n: number) => `${n}/165`,
      (n: number) => `TG${n}`,
      (n: number) => `${n}a`,
      () => '',
      () => '   ',
    ];
    const pick = (): Placed => ({
      id: '',
      cardNumber: next(10) === 0 ? null : (shapes[next(shapes.length)] ?? String)(next(300)),
      subsetSortOrder: next(4) === 0 ? null : next(5),
    });
    for (let round = 0; round < 5000; round += 1) {
      const left = pick();
      const right = pick();
      expect(Math.sign(compareCardNumbersInSubsets({ left, right }))).toBe(
        Math.sign(compareCardNumbers(left.cardNumber, right.cardNumber)),
      );
    }
  });
});
