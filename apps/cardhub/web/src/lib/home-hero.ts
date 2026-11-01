export type HomeSeries = {
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  cardCount: number;
  releaseDate: string | null;
};

/** `YYYY-MM-DD` string compare. Null and later dates are not eligible. */
export function isReleasedOnOrBefore(releaseDate: string | null, today: string): boolean {
  return releaseDate !== null && releaseDate <= today;
}

/**
 * Prefer the server row from `releasedOnOrBefore` when its date is eligible.
 * An empty or ineligible row falls back to the newest series (`createdAtDesc`).
 */
export function pickHomeHero(
  filtered: HomeSeries | undefined,
  newest: readonly HomeSeries[],
  today: string,
): { series: HomeSeries; kind: 'recent' | 'latest' } | null {
  if (filtered && isReleasedOnOrBefore(filtered.releaseDate, today)) {
    return { series: filtered, kind: 'recent' };
  }
  const first = newest[0];
  if (!first) return null;
  return { series: first, kind: 'latest' };
}

/** Drop the hero series, then keep the first eight newest rows. */
export function latestExcludingHero(
  newest: readonly HomeSeries[],
  heroSlug: string | undefined,
): HomeSeries[] {
  const rest = heroSlug ? newest.filter((series) => series.slug !== heroSlug) : [...newest];
  return rest.slice(0, 8);
}
