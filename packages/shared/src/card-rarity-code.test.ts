import { describe, expect, it } from 'vitest';
import {
  CARD_RARITY_CODE_ATTRIBUTE,
  CARD_RARITY_CODE_MAX,
  cardRarityCode,
  isSelectableCardRarityCode,
} from './card-rarity-code';

describe('cardRarityCode', () => {
  it('reads the trimmed official code from attributes.稀有度', () => {
    expect(CARD_RARITY_CODE_ATTRIBUTE).toBe('稀有度');
    expect(cardRarityCode({ 稀有度: 'SAR' })).toBe('SAR');
    expect(cardRarityCode({ 稀有度: '  ★★★ ' })).toBe('★★★');
    expect(cardRarityCode({ 稀有度: '无标记', 插画师: 'x' })).toBe('无标记');
  });

  it('returns null when there is no usable code', () => {
    expect(cardRarityCode(null)).toBeNull();
    expect(cardRarityCode(undefined)).toBeNull();
    expect(cardRarityCode({})).toBeNull();
    expect(cardRarityCode({ 稀有度: '   ' })).toBeNull();
    expect(cardRarityCode({ 稀有度: 5 })).toBeNull();
    expect(cardRarityCode({ 稀有度: null })).toBeNull();
    expect(cardRarityCode(['SAR'])).toBeNull();
    expect(cardRarityCode('SAR')).toBeNull();
  });
});

describe('isSelectableCardRarityCode', () => {
  it('counts code points, not UTF-16 units, up to the input limit', () => {
    expect(CARD_RARITY_CODE_MAX).toBe(10);
    expect(isSelectableCardRarityCode('SAR')).toBe(true);
    expect(isSelectableCardRarityCode('🂡'.repeat(10))).toBe(true);
    expect(isSelectableCardRarityCode('🂡'.repeat(11))).toBe(false);
    expect(isSelectableCardRarityCode('')).toBe(false);
  });
});
