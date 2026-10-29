import { markdownToPlainText, t, type Locale } from '@repo/shared';

/**
 * Grapheme cap for the description excerpt only. The template sentence is
 * not counted. The trailing "…" is included when the excerpt is cut.
 */
const EXCERPT_GRAPHEME_LIMIT: Record<Locale, number> = {
  'zh-CN': 120,
  'en-US': 155,
};

const ELLIPSIS = '…';

// Above either excerpt cap. markdownToPlainText otherwise cuts mid-word and
// adds its own ellipsis before the sentence or word cut below can run.
const PLAIN_TEXT_SCAN_LIMIT = 10_000;

const SENTENCE_ENDERS = new Set(['。', '！', '？', '!', '?', '…']);
const CLOSING_MARKS = new Set(['"', "'", '”', '’', '」', '』', '）', ')', ']', '】', '》', '〉']);

function graphemes(text: string, locale: Locale): string[] {
  return [...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)].map(
    (part) => part.segment,
  );
}

function isPunctuationOrSymbol(grapheme: string): boolean {
  return /^[\p{P}\p{S}]+$/u.test(grapheme);
}

function isSentenceBoundary(units: readonly string[], index: number): boolean {
  const mark = units[index];
  if (!mark) return false;
  if (SENTENCE_ENDERS.has(mark)) return true;
  if (mark !== '.') return false;

  const previous = units[index - 1];
  const next = units[index + 1];
  if (previous && /\d/u.test(previous) && next && /\d/u.test(next)) return false;
  if (next && !/\s/u.test(next)) return false;

  let after = index + 1;
  while (after < units.length && units[after] && /\s/u.test(units[after]!)) after += 1;
  const following = units[after];
  if (!following) return true;
  return /[\p{Lu}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(following);
}

function sentenceCut(units: readonly string[], budget: number): string {
  for (let index = budget - 1; index >= 0; index -= 1) {
    if (!isSentenceBoundary(units, index)) continue;
    let end = index + 1;
    while (end < budget && units[end] && CLOSING_MARKS.has(units[end]!)) end += 1;
    const cut = units.slice(0, end).join('').trimEnd();
    if (cut) return cut;
  }
  return '';
}

function wordCut(text: string, locale: Locale, budget: number): string {
  let kept = '';
  let used = 0;
  for (const part of new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)) {
    const next = used + graphemes(part.segment, locale).length;
    if (next > budget) break;
    kept += part.segment;
    used = next;
  }
  return stripTrailingPunctuation(kept.trimEnd(), locale);
}

function stripTrailingPunctuation(text: string, locale: Locale): string {
  const units = graphemes(text, locale);
  while (units.length > 0) {
    const last = units[units.length - 1];
    if (!last || !isPunctuationOrSymbol(last)) break;
    units.pop();
  }
  return units.join('').trimEnd();
}

function truncateExcerpt(text: string, locale: Locale): string {
  const normalized = text.trim();
  if (!normalized) return '';
  const max = EXCERPT_GRAPHEME_LIMIT[locale];
  const units = graphemes(normalized, locale);
  if (units.length <= max) return normalized;

  const budget = max - graphemes(ELLIPSIS, locale).length;
  const sentence = sentenceCut(units, budget);
  if (sentence) return `${sentence}${ELLIPSIS}`;

  const word = wordCut(normalized, locale, budget);
  if (word) return `${word}${ELLIPSIS}`;

  const hard = stripTrailingPunctuation(units.slice(0, budget).join(''), locale);
  return hard ? `${hard}${ELLIPSIS}` : ELLIPSIS;
}

function plainExcerpt(description: string | null | undefined, locale: Locale): string {
  if (!description?.trim()) return '';
  return truncateExcerpt(markdownToPlainText(description, PLAIN_TEXT_SCAN_LIMIT), locale);
}

function withExcerpt(template: string, excerpt: string): string {
  return excerpt ? `${template} ${excerpt}` : template;
}

function hasCardCount(cardCount: number | null | undefined): cardCount is number {
  return typeof cardCount === 'number' && Number.isInteger(cardCount) && cardCount >= 0;
}

function numberSuffix(locale: Locale, cardNumber: string | null | undefined): string {
  const number = cardNumber?.trim();
  if (!number) return '';
  return t(locale, 'meta.cardNumber', { number });
}

export function seriesMetaDescription(input: {
  locale: Locale;
  title: string;
  cardCount: number | null | undefined;
  description?: string | null;
}): string {
  const template = hasCardCount(input.cardCount)
    ? t(input.locale, 'meta.series', { title: input.title, count: input.cardCount })
    : t(input.locale, 'meta.seriesNoCount', { title: input.title });
  return withExcerpt(template, plainExcerpt(input.description, input.locale));
}

export function cardMetaDescription(input: {
  locale: Locale;
  name: string;
  seriesTitle: string;
  cardNumber?: string | null;
  description?: string | null;
}): string {
  const template = t(input.locale, 'meta.card', {
    name: input.name,
    series: input.seriesTitle,
    number: numberSuffix(input.locale, input.cardNumber),
  });
  return withExcerpt(template, plainExcerpt(input.description, input.locale));
}
