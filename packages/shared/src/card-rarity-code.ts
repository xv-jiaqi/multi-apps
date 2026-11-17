/**
 * CH-239: official rarity code (e.g. `SAR`, `★★★`, `无标记`). The importer
 * keeps the printed code in `attributes.稀有度` and maps it to the 4-tier
 * `rarity` (CH-235 §6). This module only reads that attribute.
 */
export const CARD_RARITY_CODE_ATTRIBUTE = '稀有度';

/** Longest `rarityCode` filter value, counted in code points after trim. */
export const CARD_RARITY_CODE_MAX = 10;

/** Trimmed `attributes.稀有度` when it is a non-empty string, else null. */
export function cardRarityCode(attributes: unknown): string | null {
  if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) {
    return null;
  }
  const value: unknown = Reflect.get(attributes, CARD_RARITY_CODE_ATTRIBUTE);
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return code.length > 0 ? code : null;
}

/** True when `code` is non-empty and fits the `rarityCode` input limit. */
export function isSelectableCardRarityCode(code: string): boolean {
  const length = [...code].length;
  return length > 0 && length <= CARD_RARITY_CODE_MAX;
}
