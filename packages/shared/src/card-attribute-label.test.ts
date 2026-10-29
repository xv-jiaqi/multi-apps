import { describe, expect, it } from 'vitest';
import { cardAttributeLabel, cardAttributeLabels } from './card-attribute-label';

describe('card attribute labels', () => {
  it('names the known keys in both locales and leaves unknown keys unchanged', () => {
    expect(cardAttributeLabel('zh-CN', 'attack')).toBe('攻击');
    expect(cardAttributeLabel('en-US', 'attack')).toBe('Attack');
    expect(cardAttributeLabel('zh-CN', 'health')).toBe('生命');
    expect(cardAttributeLabel('en-US', 'cost')).toBe('Cost');
    expect(cardAttributeLabel('zh-CN', 'type')).toBe('类型');
    expect(cardAttributeLabel('zh-CN', 'lore')).toBe('lore');
    expect(cardAttributeLabel('en-US', 'lore')).toBe('lore');
  });

  it('always returns the known keys first, then extra keys in code-unit order', () => {
    expect(Object.keys(cardAttributeLabels(['lore', 'attack', 'zeta', 'lore']))).toEqual([
      'cost',
      'attack',
      'health',
      'type',
      'lore',
      'zeta',
    ]);
    expect(cardAttributeLabels(['lore']).lore).toEqual({ 'zh-CN': 'lore', 'en-US': 'lore' });
    expect(cardAttributeLabels([]).attack).toEqual({ 'zh-CN': '攻击', 'en-US': 'Attack' });
  });
});
