import { normalizedCardNumber } from '../card-number-normalize';
import { CARD_NUMBER_MAX } from '../zod';

// Cross-platform timer: reference `globalThis.setTimeout` through a narrow
// declaration so this file compiles in environments that don't bundle DOM or
// Node type libraries (e.g. miniapp builds).
declare const setTimeout: (handler: () => void, timeout: number) => unknown;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export type ResolvedArtwork = { kind: 'image'; src: string } | { kind: 'placeholder' };

export function resolveArtwork(url: string | null | undefined): ResolvedArtwork {
  const src = url?.trim();
  if (src && src.toLowerCase().startsWith('https://')) {
    return { kind: 'image', src };
  }
  return { kind: 'placeholder' };
}

/**
 * Convert an arbitrary string into a kebab-case slug:
 * - lowercase ASCII
 * - non-alnum runs collapse into a single dash
 * - leading/trailing dashes trimmed
 * - capped at 64 chars (matches `slugSchema` in zod/index.ts)
 *
 * Non-ASCII characters (e.g. CJK) are stripped, so titles like "天穹黎明"
 * collapse to an empty base — callers MUST always append the random suffix
 * via `slugify` + uniqueness retry to keep the slug non-empty.
 */
export function slugifyBase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
}

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Compose a slug as `<slugifyBase(title)>-<random suffix>`. The suffix length
 * defaults to 6 chars (~36^6 ≈ 2.2B combos), which collides only after
 * ~50k topics under the birthday bound. The forum router additionally
 * retries on Prisma P2002 (unique-constraint violation) before failing.
 *
 * Cross-runtime random: prefers `globalThis.crypto.getRandomValues` when
 * present (browsers, Node 19+, Cloudflare Workers, Tauri WebView). Falls
 * back to `Math.random` so the helper still works in the most stripped-down
 * miniapp jscore variants.
 */
export function slugify(input: string, suffixLength = 6): string {
  const base = slugifyBase(input) || 'topic';
  let suffix = '';
  const cryptoLike = (
    globalThis as unknown as {
      crypto?: { getRandomValues?: (arr: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (cryptoLike?.getRandomValues) {
    const bytes = new Uint8Array(suffixLength);
    cryptoLike.getRandomValues(bytes);
    for (let i = 0; i < suffixLength; i += 1) {
      suffix += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length];
    }
  } else {
    for (let i = 0; i < suffixLength; i += 1) {
      suffix += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
    }
  }
  return `${base}-${suffix}`;
}

export const CARD_RARITY_VALUES = ['common', 'rare', 'epic', 'legendary'] as const;
export type CardRarity = (typeof CARD_RARITY_VALUES)[number];

export type CardSearchParseErrorReason = 'unknownPrefix' | 'invalidRarity';
export type CardSearchIgnoredReason = 'invalidYear' | 'cardNumberTooLong';
export type CardSearchIgnored = {
  reason: CardSearchIgnoredReason;
  token: string;
};
export type CardSearchHint = {
  reason: CardSearchParseErrorReason | CardSearchIgnoredReason;
  token: string;
};
export type CardSearchParseResult =
  | {
      ok: true;
      rarity?: CardRarity;
      seriesSlug?: string;
      /** Normalized card number (`c:`). Absent when the prefix was not used. */
      cardNumber?: string;
      /** Series release year (`y:`), including 0 from `y:0000`. */
      releaseYear?: number;
      /** First ignored `c:` / `y:` token. The rest of the query still matches. */
      ignored?: CardSearchIgnored;
      includeGroups: string[][];
      excludeTerms: string[];
    }
  | {
      ok: false;
      reason: CardSearchParseErrorReason;
      token: string;
    };

const SILENT_INCOMPLETE_PREFIXES = new Set(['r', 's', 'c', 'y']);
const RELEASE_YEAR = /^[0-9]{4}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function rememberIgnored(
  ignored: CardSearchIgnored | undefined,
  next: CardSearchIgnored,
): CardSearchIgnored {
  return ignored ?? next;
}

function appendNameToken(groups: string[][], token: string): void {
  if (groups.length === 0) groups.push([]);
  groups[groups.length - 1]!.push(token);
}

export function parseCardSearchQuery(query: string): CardSearchParseResult {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  let rarity: CardRarity | undefined;
  let seriesSlug: string | undefined;
  let cardNumber: string | undefined;
  let releaseYear: number | undefined;
  let ignored: CardSearchIgnored | undefined;
  let sawCardNumber = false;
  let sawReleaseYear = false;
  const includeGroups: string[][] = [[]];
  const excludeTerms: string[] = [];

  for (const rawToken of tokens) {
    if (rawToken === 'OR') {
      if (includeGroups[includeGroups.length - 1]!.length > 0) {
        includeGroups.push([]);
      }
      continue;
    }

    const token = rawToken.trim();
    const prefixMatch = token.match(/^([A-Za-z]+):(.+)$/);
    const incompletePrefixMatch = token.match(/^([A-Za-z]+):$/);

    if (incompletePrefixMatch) {
      const prefix = incompletePrefixMatch[1]!.toLowerCase();
      if (SILENT_INCOMPLETE_PREFIXES.has(prefix)) continue;
      return { ok: false, reason: 'unknownPrefix', token };
    }

    if (prefixMatch) {
      const prefix = prefixMatch[1]!.toLowerCase();
      const value = prefixMatch[2]!;
      if (prefix === 'r') {
        if (!CARD_RARITY_VALUES.some((item) => item === value)) {
          return { ok: false, reason: 'invalidRarity', token };
        }
        if (!rarity) {
          const matched = CARD_RARITY_VALUES.find((item) => item === value);
          if (matched) rarity = matched;
        }
        continue;
      }
      if (prefix === 's') {
        if (!seriesSlug && SLUG_PATTERN.test(value)) {
          seriesSlug = value;
        }
        continue;
      }
      if (prefix === 'c') {
        if (sawCardNumber) continue;
        const trimmed = value.trim();
        if (trimmed.length === 0) continue;
        sawCardNumber = true;
        if (trimmed.length > CARD_NUMBER_MAX) {
          ignored = rememberIgnored(ignored, { reason: 'cardNumberTooLong', token: rawToken });
          continue;
        }
        const normalized = normalizedCardNumber(trimmed);
        if (normalized) cardNumber = normalized;
        continue;
      }
      if (prefix === 'y') {
        if (sawReleaseYear) continue;
        const trimmed = value.trim();
        if (trimmed.length === 0) continue;
        sawReleaseYear = true;
        if (RELEASE_YEAR.test(trimmed)) {
          releaseYear = Number(trimmed);
        } else {
          ignored = rememberIgnored(ignored, { reason: 'invalidYear', token: rawToken });
        }
        continue;
      }
      if (/^[A-Za-z]+$/.test(prefix)) {
        return { ok: false, reason: 'unknownPrefix', token };
      }
    }

    if (/^[A-Za-z]+[<>=]/.test(token)) {
      return { ok: false, reason: 'unknownPrefix', token };
    }

    if (token.startsWith('-') && token.length > 1) {
      excludeTerms.push(token.slice(1));
      continue;
    }

    appendNameToken(includeGroups, token);
  }

  return {
    ok: true,
    ...(rarity ? { rarity } : {}),
    ...(seriesSlug ? { seriesSlug } : {}),
    ...(cardNumber ? { cardNumber } : {}),
    ...(releaseYear !== undefined ? { releaseYear } : {}),
    ...(ignored ? { ignored } : {}),
    includeGroups: includeGroups.filter((group) => group.length > 0),
    excludeTerms,
  };
}

/** Hint for the search box. Invalid `c:` / `y:` stay on an otherwise ok parse. */
export function cardSearchHint(parsed: CardSearchParseResult): CardSearchHint | null {
  if (!parsed.ok) return { reason: parsed.reason, token: parsed.token };
  if (parsed.ignored) return parsed.ignored;
  return null;
}

export function hasCardSearchConditions(
  parsed: Extract<CardSearchParseResult, { ok: true }>,
): boolean {
  return (
    Boolean(parsed.rarity) ||
    Boolean(parsed.seriesSlug) ||
    Boolean(parsed.cardNumber) ||
    parsed.releaseYear !== undefined ||
    parsed.includeGroups.length > 0 ||
    parsed.excludeTerms.length > 0
  );
}

export function shouldRequestCardSearchQuery(query: string): boolean {
  const parsed = parseCardSearchQuery(query);
  return parsed.ok && hasCardSearchConditions(parsed);
}

export function markdownToPlainText(markdown: string, maxLength: number): string {
  if (maxLength <= 0) return '';

  const source = Array.from(markdown).slice(0, 2000).join('');
  const lines: string[] = [];
  let fence: '```' | '~~~' | null = null;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      fence = trimmed.startsWith('```') ? '```' : '~~~';
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) continue;
    if (/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line)) continue;
    lines.push(line);
  }

  const plain = lines
    .join('\n')
    // Images and raw HTML do not contribute to forum list summaries.
    .replace(/!\[[^\]\n]{0,200}]\([^)\n]{0,500}\)/g, ' ')
    .replace(/<((?:https?:\/\/|mailto:)[^>\s]{0,500})>/g, '$1')
    .replace(
      /<[A-Za-z][A-Za-z0-9-]*(?:\s[^>\n]{0,200})?>[^<\n]{0,1000}<\/[A-Za-z][A-Za-z0-9-]*>/g,
      ' ',
    )
    .replace(/<\/?[A-Za-z][^>\n]{0,200}>/g, ' ')
    // Keep useful inline text while stripping Markdown delimiters.
    .replace(/\[([^\]\n]{1,500})]\([^)\n]{0,500}\)/g, '$1')
    .replace(/`([^`\n]{1,500})`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/(^|\s)[-*+]\s+\[[ xX]\]\s+/g, ' ')
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\[[ xX]\]\s+/g, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[\s([{"'])\*([^*\s][^*\n]*?)\*(?=$|[\s)\]}.,!?;:'"])/g, '$1$2')
    .replace(/(^|[\s([{"'])_([^_\s][^_\n]*?)_(?=$|[\s)\]}.,!?;:'"])/g, '$1$2')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) return '';

  const chars = Array.from(plain);
  if (chars.length <= maxLength) return plain;
  return `${chars.slice(0, maxLength).join('').trimEnd()}…`;
}
