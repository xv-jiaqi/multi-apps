import { describe, expect, it } from 'vitest';
import { normalizedCardNumber } from './card-number-normalize';

describe('normalizedCardNumber', () => {
  it('strips one leading hash, case, and leading zeros of the trailing digit run', () => {
    expect(normalizedCardNumber('7')).toBe('7');
    expect(normalizedCardNumber('007')).toBe('7');
    expect(normalizedCardNumber('#7')).toBe('7');
    expect(normalizedCardNumber('  #007  ')).toBe('7');
    expect(normalizedCardNumber('A05')).toBe('a5');
    expect(normalizedCardNumber('a5')).toBe('a5');
    expect(normalizedCardNumber('#A05')).toBe('a5');
    expect(normalizedCardNumber('A00')).toBe('a0');
    expect(normalizedCardNumber('00')).toBe('0');
  });

  it('does not treat a non-trailing digit run as the number', () => {
    expect(normalizedCardNumber('SV007')).toBe('sv7');
    expect(normalizedCardNumber('7a')).toBe('7a');
    expect(normalizedCardNumber('00A5')).toBe('00a5');
    expect(normalizedCardNumber('2/165')).toBe('2/165');
    expect(normalizedCardNumber('PROMO')).toBe('promo');
    expect(normalizedCardNumber('##7')).toBe('#7');
  });

  it('returns null for empty and hash-only values', () => {
    expect(normalizedCardNumber(null)).toBeNull();
    expect(normalizedCardNumber(undefined)).toBeNull();
    expect(normalizedCardNumber('')).toBeNull();
    expect(normalizedCardNumber('   ')).toBeNull();
    expect(normalizedCardNumber('#')).toBeNull();
    expect(normalizedCardNumber('#   ')).toBeNull();
  });
});
