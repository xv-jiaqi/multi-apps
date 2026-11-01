import type { Locale } from './constants';
import { t } from './i18n';

/**
 * Print-run sentence from CH-213 §2.
 * `null` is unnumbered. A number is the total only, with no grouping
 * separators (`/1000`, not `/1,000`). The per-copy form `12/99` is out of scope.
 * The UI applies `font-mono tabular-nums` to the digits.
 */
export function printRunLabel(locale: Locale, printRun: number | null): string {
  if (printRun === null) return t(locale, 'card.variant.unnumbered');
  return t(locale, 'card.variant.limited', { n: printRun });
}
