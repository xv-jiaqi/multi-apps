import { describe, expect, it } from 'vitest';
import { rarityCodeLabel } from './rarity-code-label';

describe('rarityCodeLabel (Spec CH-239 §3)', () => {
  it('maps the known non-letter codes to visible text and a spoken name', () => {
    expect(rarityCodeLabel('zh-CN', '无标记')).toEqual({ visible: '无标记', spoken: '无标记' });
    expect(rarityCodeLabel('en-US', '无标记')).toEqual({ visible: 'Unmarked', spoken: 'Unmarked' });
    expect(rarityCodeLabel('zh-CN', '●')).toEqual({ visible: '●', spoken: '圆形标记' });
    expect(rarityCodeLabel('en-US', '◆')).toEqual({ visible: '◆', spoken: 'Diamond mark' });
    expect(rarityCodeLabel('zh-CN', '★')).toEqual({ visible: '★', spoken: '一星' });
    expect(rarityCodeLabel('en-US', '★★')).toEqual({ visible: '★★', spoken: 'Two stars' });
    expect(rarityCodeLabel('zh-CN', '★★★')).toEqual({ visible: '★★★', spoken: '三星' });
  });

  it('keeps letter codes as printed and prefixes the spoken name', () => {
    expect(rarityCodeLabel('zh-CN', 'SAR')).toEqual({ visible: 'SAR', spoken: '稀有度码 SAR' });
    expect(rarityCodeLabel('en-US', 'C')).toEqual({ visible: 'C', spoken: 'Rarity code C' });
    expect(rarityCodeLabel('en-US', 'sar')).toEqual({ visible: 'sar', spoken: 'Rarity code sar' });
  });

  it('uses the raw code for any other code', () => {
    expect(rarityCodeLabel('zh-CN', '☆☆')).toEqual({ visible: '☆☆', spoken: '☆☆' });
    expect(rarityCodeLabel('en-US', '金')).toEqual({ visible: '金', spoken: '金' });
    expect(rarityCodeLabel('en-US', 'S-1')).toEqual({ visible: 'S-1', spoken: 'S-1' });
  });
});
