import {
  APP_ERROR_CODES,
  RELEASE_NOTE_MAX,
  RELEASE_TITLE_MAX,
  appErrorMessage,
  fieldErrorMessage,
  releaseCreateInput,
  t,
  type Locale,
  type ReleaseCreateInput,
  type ReleaseRegionValue,
} from '@repo/shared';

export interface ReleaseFormValues {
  title: string;
  releaseDate: string;
  monthOnly: boolean;
  region: '' | ReleaseRegionValue;
  seriesId: string | null;
  categoryId: string | null;
  note: string;
  sourceUrl: string;
}

const REGION_VALUES = new Set<ReleaseRegionValue>(['CN', 'JP', 'GLOBAL']);

const FIELD_KEYS = new Set([
  'title',
  'releaseDate',
  'region',
  'seriesId',
  'categoryId',
  'note',
  'sourceUrl',
]);

/**
 * Trim and turn `2026/11/06` or `2026.11.06` into `2026-11-06`.
 * Month precision keeps `YYYY-MM` and drops a day when one was typed.
 */
export function normalizeReleaseDateInput(raw: string, monthOnly: boolean): string {
  const unified = raw.trim().replace(/[/.]/g, '-');
  const parts = unified.split('-');
  if (parts.some((part) => !/^\d+$/.test(part))) return unified;
  const year = parts[0] ?? '';
  const month = parts[1] ?? '';
  const day = parts[2] ?? '';
  if (monthOnly && (parts.length === 2 || parts.length === 3) && year && month) {
    return `${year.padStart(4, '0')}-${month.padStart(2, '0')}`;
  }
  if (!monthOnly && parts.length === 3 && year && month && day) {
    return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return unified;
}

/** Payload for create and update. Empty optional fields are `null`, never `''`. */
export function releaseWriteInput(values: ReleaseFormValues): ReleaseCreateInput {
  const shown = normalizeReleaseDateInput(values.releaseDate, values.monthOnly);
  const releaseDate = values.monthOnly && /^\d{4}-\d{2}$/.test(shown) ? `${shown}-01` : shown;
  const note = values.note.trim();
  const sourceUrl = values.sourceUrl.trim();
  return {
    title: values.title.trim(),
    releaseDate,
    datePrecision: values.monthOnly ? 'MONTH' : 'DAY',
    region: values.region === '' ? null : values.region,
    seriesId: values.seriesId,
    categoryId: values.categoryId,
    note: note.length === 0 ? null : note,
    sourceUrl: sourceUrl.length === 0 ? null : sourceUrl,
  };
}

function remember(fields: Record<string, string>, key: string, text: string) {
  if (!key || fields[key]) return;
  fields[key] = text;
}

/** Same sentences as the server, checked on blur and submit. */
export function releaseFormErrors(
  values: ReleaseFormValues,
  locale: Locale,
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (values.title.length > RELEASE_TITLE_MAX) {
    remember(fields, 'title', fieldErrorMessage(locale, 'title_too_long'));
  }
  if (values.note.length > RELEASE_NOTE_MAX) {
    remember(fields, 'note', fieldErrorMessage(locale, 'release_note_too_long'));
  }
  if (values.region !== '' && !REGION_VALUES.has(values.region)) {
    remember(fields, 'region', fieldErrorMessage(locale, 'release_region'));
  }
  const parsed = releaseCreateInput.safeParse(releaseWriteInput(values));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const head = issue.path[0];
      const key = head === 'datePrecision' ? 'releaseDate' : String(head ?? '');
      if (!FIELD_KEYS.has(key)) continue;
      remember(fields, key, fieldErrorMessage(locale, issue.message));
    }
  }
  return fields;
}

export interface ReleaseWriteFeedback {
  fields: Record<string, string>;
  message: string | null;
  /** The release row itself is gone. Series and category misses stay on the field. */
  gone: boolean;
}

interface ZodLike {
  path: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function zodIssues(zodError: unknown, message: string): ZodLike[] {
  const issues: ZodLike[] = [];
  const push = (path: string, text: string) => {
    if (!text) return;
    issues.push({ path, message: text });
  };
  if (isRecord(zodError)) {
    if (Array.isArray(zodError.issues)) {
      for (const issue of zodError.issues) {
        if (!isRecord(issue)) continue;
        const path = Array.isArray(issue.path) ? issue.path : [];
        const head = path.find((part) => typeof part === 'string' || typeof part === 'number');
        const text = typeof issue.message === 'string' ? issue.message : '';
        push(head === undefined ? '' : String(head), text);
      }
    }
    if (issues.length === 0 && isRecord(zodError.fieldErrors)) {
      for (const [field, messages] of Object.entries(zodError.fieldErrors)) {
        const list = Array.isArray(messages) ? messages : [messages];
        const text = list.find((item) => typeof item === 'string');
        if (typeof text === 'string') push(field, text);
      }
    }
  }
  if (issues.length > 0) return issues;
  const trimmed = message.trim();
  if (!trimmed.startsWith('[')) return issues;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return issues;
    for (const issue of parsed) {
      if (!isRecord(issue)) continue;
      const path = Array.isArray(issue.path) ? issue.path : [];
      const head = path.find((part) => typeof part === 'string' || typeof part === 'number');
      const text = typeof issue.message === 'string' ? issue.message : '';
      push(head === undefined ? '' : String(head), text);
    }
  } catch {
    return issues;
  }
  return issues;
}

function readError(error: unknown): {
  code?: string;
  appCode?: string;
  message: string;
  zodError?: unknown;
} {
  if (!isRecord(error)) return { message: '' };
  const data = isRecord(error.data) ? error.data : {};
  return {
    code: typeof data.code === 'string' ? data.code : undefined,
    appCode: typeof data.appCode === 'string' ? data.appCode : undefined,
    message: typeof error.message === 'string' ? error.message : '',
    zodError: data.zodError,
  };
}

function terminalMessage(
  locale: Locale,
  code: string | undefined,
  appCode: string | undefined,
): string | null {
  const token = appCode ?? code;
  if (
    token === APP_ERROR_CODES.FORBIDDEN ||
    token === APP_ERROR_CODES.UNAUTHORIZED ||
    token === APP_ERROR_CODES.TOO_MANY_REQUESTS
  ) {
    return appErrorMessage(locale, token);
  }
  if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED' || code === 'TOO_MANY_REQUESTS') {
    return appErrorMessage(locale, code);
  }
  return null;
}

/** Field sentences for a failed create or update. Never returns a raw code. */
export function releaseWriteFeedback(locale: Locale, error: unknown): ReleaseWriteFeedback {
  const data = readError(error);
  const terminal = terminalMessage(locale, data.code, data.appCode);
  if (terminal) return { fields: {}, message: terminal, gone: false };
  if (data.code === 'NOT_FOUND' || data.appCode === APP_ERROR_CODES.NOT_FOUND) {
    if (data.message === '系列不存在') {
      return {
        fields: { seriesId: t(locale, 'admin.releases.seriesMissing') },
        message: null,
        gone: false,
      };
    }
    if (data.message === '品类不存在') {
      return {
        fields: { categoryId: t(locale, 'admin.releases.categoryMissing') },
        message: null,
        gone: false,
      };
    }
    return { fields: {}, message: t(locale, 'admin.releases.missing'), gone: true };
  }
  const fields: Record<string, string> = {};
  for (const issue of zodIssues(data.zodError, data.message)) {
    const key = issue.path === 'datePrecision' ? 'releaseDate' : issue.path;
    if (!FIELD_KEYS.has(key)) continue;
    remember(fields, key, fieldErrorMessage(locale, issue.message));
  }
  return {
    fields,
    message: Object.keys(fields).length > 0 ? null : t(locale, 'admin.saveFailed'),
    gone: false,
  };
}

export function releaseNotFound(error: unknown): boolean {
  const data = readError(error);
  return data.code === 'NOT_FOUND' || data.appCode === APP_ERROR_CODES.NOT_FOUND;
}
