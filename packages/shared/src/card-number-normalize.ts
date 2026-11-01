/**
 * Exact-match key for `/search` `c:`.
 *
 * Trim, drop one leading `#`, compare case-insensitively, then strip leading
 * zeros from the trailing digit run only (`7` = `007` = `#7`, `A05` = `A5`).
 * A value with no trailing digits is kept as-is after the case fold, so `7a`
 * does not match `7` and `SV007` does not match `7`.
 */
export function normalizedCardNumber(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  let raw = value.trim();
  if (raw.startsWith('#')) raw = raw.slice(1).trim();
  if (raw.length === 0) return null;
  raw = raw.toLowerCase();
  const match = /^(.*?)(\d+)$/.exec(raw);
  if (!match) return raw;
  const head = match[1] ?? '';
  const digits = match[2] ?? '';
  const stripped = digits.replace(/^0+/, '');
  return `${head}${stripped.length > 0 ? stripped : '0'}`;
}
