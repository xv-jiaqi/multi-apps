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
export type CardSearchParseResult =
  | {
      ok: true;
      rarity?: CardRarity;
      seriesSlug?: string;
      includeGroups: string[][];
      excludeTerms: string[];
    }
  | {
      ok: false;
      reason: CardSearchParseErrorReason;
      token: string;
    };

const RESERVED_PREFIXES = new Set(['r', 's']);
const RESERVED_FUTURE_PREFIXES = new Set(['c', 'y']);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
      if (RESERVED_PREFIXES.has(prefix)) continue;
      return { ok: false, reason: 'unknownPrefix', token };
    }

    if (prefixMatch) {
      const prefix = prefixMatch[1]!.toLowerCase();
      const value = prefixMatch[2]!;
      if (prefix === 'r') {
        if (!(CARD_RARITY_VALUES as readonly string[]).includes(value)) {
          return { ok: false, reason: 'invalidRarity', token };
        }
        if (!rarity) rarity = value as CardRarity;
        continue;
      }
      if (prefix === 's') {
        if (!seriesSlug && SLUG_PATTERN.test(value)) {
          seriesSlug = value;
        }
        continue;
      }
      if (RESERVED_FUTURE_PREFIXES.has(prefix) || /^[A-Za-z]+$/.test(prefix)) {
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
    includeGroups: includeGroups.filter((group) => group.length > 0),
    excludeTerms,
  };
}
