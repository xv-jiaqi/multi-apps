import { t, type Locale } from '@repo/shared';

/** Spec CH-239 §3: known non-letter codes. The form value stays the raw code. */
const SYMBOL_KEYS: Record<string, { key: string; visibleTranslated: boolean }> = {
  无标记: { key: 'series.rarityCode.unmarked', visibleTranslated: true },
  '●': { key: 'series.rarityCode.circle', visibleTranslated: false },
  '◆': { key: 'series.rarityCode.diamond', visibleTranslated: false },
  '★': { key: 'series.rarityCode.star1', visibleTranslated: false },
  '★★': { key: 'series.rarityCode.star2', visibleTranslated: false },
  '★★★': { key: 'series.rarityCode.star3', visibleTranslated: false },
};

const LETTER_CODE = /^[A-Za-z]+$/;

export type RarityCodeLabel = { visible: string; spoken: string };

/**
 * Visible text and screen-reader name for an official rarity code. Letter
 * codes are never translated; their spoken name adds 「稀有度码」 / "Rarity code".
 */
export function rarityCodeLabel(locale: Locale, code: string): RarityCodeLabel {
  const symbol = SYMBOL_KEYS[code];
  if (symbol) {
    const spoken = t(locale, symbol.key);
    return { visible: symbol.visibleTranslated ? spoken : code, spoken };
  }
  if (LETTER_CODE.test(code)) {
    return { visible: code, spoken: t(locale, 'series.rarityCode.named', { code }) };
  }
  return { visible: code, spoken: code };
}
