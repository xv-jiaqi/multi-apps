import type { Locale } from './constants';
import { t } from './i18n';

/** Keys the checklist knows how to name. Anything else is shown as written. */
export const KNOWN_CARD_ATTRIBUTE_KEYS = ['cost', 'attack', 'health', 'type'] as const;

const KNOWN_KEYS = new Set<string>(KNOWN_CARD_ATTRIBUTE_KEYS);

export type CardAttributeLabelSet = Record<Locale, string>;

export function cardAttributeLabel(locale: Locale, key: string): string {
  const i18nKey = `card.attr.${key}`;
  const text = t(locale, i18nKey);
  return text === i18nKey ? key : text;
}

/**
 * Known keys always come first, in dictionary order. Extra keys follow,
 * sorted by code unit, and use the raw key when neither locale has a label.
 */
export function cardAttributeLabels(
  keys: readonly string[],
): Record<string, CardAttributeLabelSet> {
  const extra: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key) || KNOWN_KEYS.has(key)) continue;
    seen.add(key);
    extra.push(key);
  }
  extra.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const labels: Record<string, CardAttributeLabelSet> = {};
  for (const key of [...KNOWN_CARD_ATTRIBUTE_KEYS, ...extra]) {
    labels[key] = {
      'zh-CN': cardAttributeLabel('zh-CN', key),
      'en-US': cardAttributeLabel('en-US', key),
    };
  }
  return labels;
}
