import { CARD_RARITY_VALUES, type CardRarity } from '@repo/shared';

const PREFIXED = /^([A-Za-z]+):(.*)$/;
const RARITIES = new Set<string>(CARD_RARITY_VALUES);

export function queryTokens(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function firstPrefixedValue(query: string, prefix: 'r' | 's'): string | undefined {
  for (const token of queryTokens(query)) {
    const match = PREFIXED.exec(token);
    if (!match || match[1]!.toLowerCase() !== prefix || !match[2]) continue;
    return match[2];
  }
  return undefined;
}

export function replacePrefixedValue(
  query: string,
  prefix: 'r' | 's',
  value: string | null,
): string {
  const kept = queryTokens(query).filter((token) => {
    const match = PREFIXED.exec(token);
    return !(match && match[1]!.toLowerCase() === prefix);
  });
  if (value) kept.push(`${prefix}:${value}`);
  return kept.join(' ');
}

export function clearRarityAndSeries(query: string): string {
  return replacePrefixedValue(replacePrefixedValue(query, 'r', null), 's', null);
}

export function selectedRarity(query: string): CardRarity | 'any' {
  const value = firstPrefixedValue(query, 'r');
  if (value && RARITIES.has(value)) return value as CardRarity;
  return 'any';
}

export function hasRarityOrSeriesFilter(query: string): boolean {
  return (
    firstPrefixedValue(query, 'r') !== undefined || firstPrefixedValue(query, 's') !== undefined
  );
}
