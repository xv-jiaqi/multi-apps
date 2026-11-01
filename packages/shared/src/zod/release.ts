import { z } from 'zod';
import { formatUtcCalendarDate, inclusiveUtcDayCount, utcCalendarDate } from './metrics';

/** Same rule as `slugSchema`. Kept here so this module does not import the zod barrel. */
const categorySlugInput = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug_format');

/** Inclusive civil-day span for `releases.list`. One day past a leap year is rejected. */
export const RELEASE_RANGE_MAX_DAYS = 366;

export const RELEASE_TITLE_MAX = 120;
export const RELEASE_NOTE_MAX = 500;
export const RELEASE_SOURCE_URL_MAX = 2048;

/**
 * Opaque keyset cursors are `base64url(YYYY-MM-DD + "|" + uuid)`, 63 characters.
 * One extra character still fits; anything longer is a field error, not a gateway 431.
 * A request line the gateway rejects with 431 or 414 is left as that status.
 */
export const RELEASE_CURSOR_MAX = 64;

export const RELEASE_LIST_LIMIT_DEFAULT = 50;
export const RELEASE_LIST_LIMIT_MAX = 100;

export type ReleaseRegionValue = 'CN' | 'JP' | 'GLOBAL';
export type ReleaseDatePrecisionValue = 'DAY' | 'MONTH';

const CIVIL_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` as a civil date in Asia/Shanghai.
 * Shanghai has no daylight-saving shift, so the label is the UTC calendar day
 * stored in `@db.Date`. Slashes, dots, and instants are rejected.
 */
export function parseShanghaiCivilDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!CIVIL_DAY.test(trimmed)) return null;
  return utcCalendarDate(trimmed);
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  for (const part of parts) {
    if (part.type === type) return part.value;
  }
  return '';
}

/** Civil `YYYY-MM-DD` of an instant in Asia/Shanghai. */
export function shanghaiCivilDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = datePart(parts, 'year');
  const month = datePart(parts, 'month');
  const day = datePart(parts, 'day');
  if (!year || !month || !day) {
    throw new Error('Asia/Shanghai date parts missing');
  }
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM` of an instant in Asia/Shanghai. */
export function shanghaiYearMonth(instant: Date): string {
  return shanghaiCivilDate(instant).slice(0, 7);
}

/**
 * Closed civil interval of a calendar month in Asia/Shanghai.
 * `2026-11` is `2026-11-01` through `2026-11-30`.
 */
export function shanghaiMonthBounds(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1 || year > 9999 || monthNumber < 1 || monthNumber > 12) return null;
  const from = new Date(Date.UTC(year, monthNumber - 1, 1));
  const to = new Date(Date.UTC(year, monthNumber, 0));
  return {
    from: formatUtcCalendarDate(from),
    to: formatUtcCalendarDate(to),
  };
}

/** MONTH precision stores the first civil day. DAY keeps the validated day. */
export function storedReleaseDate(
  value: string,
  precision: ReleaseDatePrecisionValue,
): Date | null {
  const parsed = parseShanghaiCivilDate(value);
  if (!parsed) return null;
  if (precision === 'DAY') return parsed;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
}

function isHttpsUrl(value: string): boolean {
  if (!value.startsWith('https://') || /\s/.test(value)) return false;
  const host = value.slice('https://'.length).split('/')[0] ?? '';
  return host.length > 0;
}

const releaseDateInput = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (!parseShanghaiCivilDate(value)) {
      ctx.addIssue({ code: 'custom', message: 'invalid_date' });
    }
  });

const releaseRegionInput = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx): ReleaseRegionValue | null | undefined => {
    if (value === undefined || value === null) return value;
    if (value === 'CN' || value === 'JP' || value === 'GLOBAL') return value;
    ctx.addIssue({ code: 'custom', message: 'release_region' });
    return z.NEVER;
  });

const releaseSourceUrlInput = z
  .union([z.string().trim().max(RELEASE_SOURCE_URL_MAX), z.null()])
  .optional()
  .transform((value, ctx): string | null | undefined => {
    if (value === undefined || value === null) return value;
    if (!isHttpsUrl(value)) {
      ctx.addIssue({ code: 'custom', message: 'source_url' });
      return z.NEVER;
    }
    return value;
  });

const releaseNoteInput = z
  .union([z.string().trim().max(RELEASE_NOTE_MAX, 'note_too_long'), z.null()])
  .optional()
  .transform((value): string | null | undefined => {
    if (value === undefined || value === null) return value;
    return value.length === 0 ? null : value;
  });

export const releaseCreateInput = z.object({
  title: z.string().trim().min(1, 'title_required').max(RELEASE_TITLE_MAX, 'title_too_long'),
  releaseDate: releaseDateInput,
  datePrecision: z.enum(['DAY', 'MONTH']).default('DAY'),
  region: releaseRegionInput,
  seriesId: z.union([z.string().uuid(), z.null()]).optional(),
  categoryId: z.union([z.string().uuid(), z.null()]).optional(),
  note: releaseNoteInput,
  sourceUrl: releaseSourceUrlInput,
});
export type ReleaseCreateInput = z.infer<typeof releaseCreateInput>;

export const releaseUpdateInput = releaseCreateInput.extend({
  id: z.string().uuid(),
});
export type ReleaseUpdateInput = z.infer<typeof releaseUpdateInput>;

export const releaseDeleteInput = z.object({
  id: z.string().uuid(),
});
export type ReleaseDeleteInput = z.infer<typeof releaseDeleteInput>;

const releaseListLimit = z.number().int().min(1).max(RELEASE_LIST_LIMIT_MAX);

const releaseCursorInput = z.string().min(1).max(RELEASE_CURSOR_MAX);

/**
 * Public range. `from` and `to` are required Asia/Shanghai civil dates.
 * The interval is closed. A span of 366 days is allowed; 367 is not.
 * `cursor` and `limit` page inside that interval. Omit both to return every row.
 */
export const releasesListInput = z
  .object({
    from: z.string().trim(),
    to: z.string().trim(),
    categorySlug: categorySlugInput.optional(),
    cursor: releaseCursorInput.optional(),
    limit: releaseListLimit.optional(),
  })
  .superRefine((value, ctx) => {
    const from = parseShanghaiCivilDate(value.from);
    const to = parseShanghaiCivilDate(value.to);
    if (!from) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'invalid_date' });
    }
    if (!to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'invalid_date' });
    }
    if (!from || !to) return;
    if (to.getTime() < from.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'release_range_order' });
      return;
    }
    if (inclusiveUtcDayCount(from, to) > RELEASE_RANGE_MAX_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'release_range_too_long' });
    }
  });
export type ReleasesListInput = z.infer<typeof releasesListInput>;

/** Admin list. Limit defaults to 50 and is never clamped into range. */
export const adminReleasesListInput = z.object({
  cursor: releaseCursorInput.optional(),
  limit: releaseListLimit.default(RELEASE_LIST_LIMIT_DEFAULT),
});
export type AdminReleasesListInput = z.infer<typeof adminReleasesListInput>;
