/** `YYYY-MM-DD` from a Prisma `@db.Date` value, which arrives as UTC midnight. */
export function formatReleaseDate(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Validated `YYYY-MM-DD` to a UTC midnight Date for `@db.Date`. */
export function parseReleaseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

/** Undefined leaves the column unchanged. Empty string clears it. */
export function releaseDateForInput(value: string | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === '') return null;
  return parseReleaseDate(value);
}

export function cardNumberForInput(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
