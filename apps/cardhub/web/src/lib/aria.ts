/**
 * Joins `aria-describedby` ids. Adds to whatever a field already points at
 * instead of replacing it (CH-226 §7-8 v1.4); `undefined` when there is none.
 */
export function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const kept = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return kept.length > 0 ? kept.join(' ') : undefined;
}
