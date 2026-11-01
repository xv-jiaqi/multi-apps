/**
 * Page start for an ascending (createdAt, id) list so `aroundId` lands on
 * that page. `countBefore` is how many rows sort strictly before the target.
 */
export function aroundPageSkip(countBefore: number, limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) return 0;
  const before = Number.isInteger(countBefore) && countBefore > 0 ? countBefore : 0;
  return Math.floor(before / limit) * limit;
}
