import { markdownToPlainText, t, type Locale } from '@repo/shared';

/**
 * Grapheme cap for the whole meta content, template sentence included.
 * The limit follows the UI locale. The trailing "…" counts toward it.
 * A cut description shorter than the minimum is dropped, leaving the template.
 */
const META_CONTENT_GRAPHEME_LIMIT: Record<Locale, number> = {
  'zh-CN': 120,
  'en-US': 155,
};

const MIN_KEPT_DESCRIPTION_GRAPHEMES = 10;

const ELLIPSIS = '…';

// Above either excerpt cap. markdownToPlainText otherwise cuts mid-word and
// adds its own ellipsis before the sentence or word cut below can run.
const PLAIN_TEXT_SCAN_LIMIT = 10_000;

const SENTENCE_ENDERS = new Set(['。', '！', '？', '!', '?', '…']);
const CLOSING_MARKS = new Set(['"', "'", '”', '’', '」', '』', '）', ')', ']', '】', '》', '〉']);

const graphemeSegmenters = new Map<Locale, Intl.Segmenter>();
const wordSegmenters = new Map<Locale, Intl.Segmenter>();

function segmenter(
  cache: Map<Locale, Intl.Segmenter>,
  locale: Locale,
  granularity: 'grapheme' | 'word',
): Intl.Segmenter {
  const cached = cache.get(locale);
  if (cached) return cached;
  const created = new Intl.Segmenter(locale, { granularity });
  cache.set(locale, created);
  return created;
}

function graphemes(text: string, locale: Locale): string[] {
  return [...segmenter(graphemeSegmenters, locale, 'grapheme').segment(text)].map(
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
  const words = segmenter(wordSegmenters, locale, 'word');
  let kept = '';
  let used = 0;
  for (const part of words.segment(text)) {
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

function truncateToRoom(text: string, locale: Locale, room: number): string {
  const units = graphemes(text, locale);
  if (units.length <= room) return text;
  const budget = room - graphemes(ELLIPSIS, locale).length;
  if (budget < 1) return ELLIPSIS;

  const sentence = sentenceCut(units, budget);
  if (sentence) return `${sentence}${ELLIPSIS}`;

  const word = wordCut(text, locale, budget);
  if (word) return `${word}${ELLIPSIS}`;

  const hard = stripTrailingPunctuation(units.slice(0, budget).join(''), locale);
  return hard ? `${hard}${ELLIPSIS}` : ELLIPSIS;
}

function plainText(description: string | null | undefined): string {
  if (!description?.trim()) return '';
  return markdownToPlainText(description, PLAIN_TEXT_SCAN_LIMIT).trim();
}

function withDescription(
  template: string,
  description: string | null | undefined,
  locale: Locale,
): string {
  const plain = plainText(description);
  if (!plain) return template;

  const limit = META_CONTENT_GRAPHEME_LIMIT[locale];
  const room = limit - graphemes(template, locale).length - 1;
  if (graphemes(plain, locale).length <= room) return `${template} ${plain}`;
  if (room < MIN_KEPT_DESCRIPTION_GRAPHEMES) return template;

  const excerpt = truncateToRoom(plain, locale, room);
  if (graphemes(excerpt, locale).length < MIN_KEPT_DESCRIPTION_GRAPHEMES) return template;
  return `${template} ${excerpt}`;
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
  return withDescription(template, input.description, input.locale);
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
  return withDescription(template, input.description, input.locale);
}
