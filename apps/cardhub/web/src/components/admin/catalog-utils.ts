import {
  ADMIN_ATTRIBUTE_KEY_MAX,
  ADMIN_ATTRIBUTE_MAX_KEYS,
  ADMIN_ATTRIBUTE_VALUE_MAX,
  LISTING_IMAGE_URL_MAX,
  slugSchema,
  t,
  type Locale,
} from '@repo/shared';

export interface AdminSeriesItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  cardCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCardItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  attributes: Record<string, string | number | boolean>;
  seriesSlug: string;
  seriesTitle: string;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ImportStatus = 'created' | 'updated' | 'unchanged' | 'error';

export interface ImportRowResult {
  row: {
    row: number;
    type: 'series' | 'card';
    slug: string | null;
    name: string | null;
    seriesSlug?: string | null;
  };
  status: ImportStatus;
  errors: Array<{ path: string; code: string; message?: string }>;
}

export interface AdminCatalogDetails {
  code?: string;
  cardCount?: number;
  commentCount?: number;
  rows?: ImportRowResult[];
}

const ERROR_KEYS: Record<string, string> = {
  REQUIRED: 'admin.error.required',
  TOO_LONG: 'admin.error.tooLong',
  SLUG_FORMAT: 'admin.error.slugFormat',
  SLUG_TAKEN: 'admin.error.slugTaken',
  SLUG_DUPLICATE_IN_FILE: 'admin.error.slugDuplicateInFile',
  IMAGE_URL: 'admin.error.imageUrl',
  INVALID_RARITY: 'admin.error.rarity',
  INVALID_TYPE: 'admin.error.invalidType',
  SERIES_NOT_FOUND: 'admin.error.seriesNotFound',
};

export function formatAdminCount(
  locale: Locale,
  kind: 'cards' | 'comments' | 'seriesComments',
  count: number,
): string {
  return t(locale, `admin.count.${kind}`, { count });
}

export function readTrpcFailure(error: unknown): {
  trpcCode?: string;
  appCode?: string;
  message: string;
  admin?: AdminCatalogDetails;
} {
  if (!error || typeof error !== 'object') return { message: '' };
  const record = error as {
    message?: unknown;
    data?: { code?: unknown; appCode?: unknown; adminCatalogError?: AdminCatalogDetails };
  };
  return {
    trpcCode: typeof record.data?.code === 'string' ? record.data.code : undefined,
    appCode: typeof record.data?.appCode === 'string' ? record.data.appCode : undefined,
    message: typeof record.message === 'string' ? record.message : '',
    admin: record.data?.adminCatalogError,
  };
}

export function isAccessRevoked(error: unknown): boolean {
  const failure = readTrpcFailure(error);
  if (failure.admin?.code === 'SERIES_HAS_CARDS') return false;
  return failure.trpcCode === 'FORBIDDEN';
}

export function isSeriesHasCards(error: unknown): AdminCatalogDetails | null {
  const failure = readTrpcFailure(error);
  if (failure.admin?.code !== 'SERIES_HAS_CARDS') return null;
  return failure.admin;
}

export function adminErrorText(locale: Locale, code: string | undefined, message: string): string {
  if (code && ERROR_KEYS[code]) return t(locale, ERROR_KEYS[code]);
  return t(locale, 'admin.error.unknown', { message });
}

export function failureText(locale: Locale, error: unknown, fallbackKey: string): string {
  const failure = readTrpcFailure(error);
  if (failure.admin?.code && failure.admin.code !== 'SERIES_HAS_CARDS') {
    return adminErrorText(locale, failure.admin.code, failure.message);
  }
  return t(locale, fallbackKey);
}

const KNOWN_FIELDS = new Set([
  'slug',
  'title',
  'name',
  'description',
  'coverUrl',
  'imageUrl',
  'rarity',
  'seriesSlug',
  'series',
  'attributes',
]);

interface ZodIssueLike {
  path?: unknown;
  message?: unknown;
  code?: unknown;
  maximum?: unknown;
  issues?: unknown;
}

export interface ValidationFeedback {
  fields: Record<string, string>;
  message: string | null;
}

function issuePath(path: unknown): string[] {
  if (!Array.isArray(path)) return [];
  return path
    .filter((part) => typeof part === 'string' || typeof part === 'number')
    .map((part) => String(part));
}

function isIssue(value: unknown): value is ZodIssueLike {
  return Boolean(value) && typeof value === 'object';
}

function issueCode(issue: ZodIssueLike): string {
  return typeof issue.code === 'string' ? issue.code : '';
}

function issueMaximum(issue: ZodIssueLike, fallback: number): number {
  return typeof issue.maximum === 'number' ? issue.maximum : fallback;
}

function nestedKeyMaximum(issue: ZodIssueLike): number {
  if (!Array.isArray(issue.issues)) return ADMIN_ATTRIBUTE_KEY_MAX;
  for (const nested of issue.issues) {
    if (isIssue(nested) && typeof nested.maximum === 'number') return nested.maximum;
  }
  return ADMIN_ATTRIBUTE_KEY_MAX;
}

function localizeAdminIssue(locale: Locale, issue: ZodIssueLike, path: string[]): string {
  const code = issueCode(issue);
  const head = path[0];
  const message = typeof issue.message === 'string' ? issue.message.trim() : '';
  if (code === 'custom' && head === 'attributes' && path.length === 1) {
    return t(locale, 'admin.attrs.errorTooMany', { max: ADMIN_ATTRIBUTE_MAX_KEYS });
  }
  if (code === 'invalid_key' && head === 'attributes') {
    return t(locale, 'admin.attrs.errorKeyLength', { max: nestedKeyMaximum(issue) });
  }
  if (code === 'too_big') {
    if (head === 'imageUrl' || head === 'coverUrl') {
      return t(locale, 'admin.error.imageTooLong', {
        max: issueMaximum(issue, LISTING_IMAGE_URL_MAX),
      });
    }
    if (head === 'attributes') {
      return t(locale, 'admin.attrs.errorValueLength', {
        max: issueMaximum(issue, ADMIN_ATTRIBUTE_VALUE_MAX),
      });
    }
    return t(locale, 'admin.error.tooLong');
  }
  if (code === 'custom' && (head === 'imageUrl' || head === 'coverUrl') && path.length === 1) {
    return t(locale, 'admin.error.imageUrl');
  }
  return message || t(locale, 'admin.error.invalidType');
}

function isAttributeCapIssue(path: string[], issue: ZodIssueLike): boolean {
  if (path[0] !== 'attributes') return false;
  const code = issueCode(issue);
  if (path.length === 1) return code === 'custom';
  return code === 'invalid_key' || code === 'too_big';
}

function issuesFromMessage(message: string): ZodIssueLike[] {
  const trimmed = message.trim();
  if (!trimmed.startsWith('[')) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isIssue);
  } catch {
    return [];
  }
}

function issuesFromZodError(zodError: unknown): ZodIssueLike[] {
  if (!zodError || typeof zodError !== 'object') return [];
  const record = zodError as {
    fieldErrors?: Record<string, unknown>;
    formErrors?: unknown;
    issues?: unknown;
  };
  if (Array.isArray(record.issues)) return record.issues.filter(isIssue);
  const issues: ZodIssueLike[] = [];
  if (record.fieldErrors && typeof record.fieldErrors === 'object') {
    for (const [field, messages] of Object.entries(record.fieldErrors)) {
      const list = Array.isArray(messages) ? messages : [messages];
      for (const message of list) {
        if (typeof message === 'string' && message) issues.push({ path: [field], message });
      }
    }
  }
  if (Array.isArray(record.formErrors)) {
    for (const message of record.formErrors) {
      if (typeof message === 'string' && message) issues.push({ path: [], message });
    }
  }
  return issues;
}

export function readValidationFeedback(
  locale: Locale,
  error: unknown,
  fallbackKey: string,
): ValidationFeedback {
  const failure = readTrpcFailure(error);
  if (failure.admin?.code && failure.admin.code !== 'SERIES_HAS_CARDS') {
    return { fields: {}, message: adminErrorText(locale, failure.admin.code, failure.message) };
  }

  const zodError = (error as { data?: { zodError?: unknown } } | null)?.data?.zodError;
  const fromZod = issuesFromZodError(zodError);
  const issues = fromZod.length > 0 ? fromZod : issuesFromMessage(failure.message);
  if (issues.length > 0) {
    const fields: Record<string, string> = {};
    const extras: string[] = [];
    for (const issue of issues) {
      const path = issuePath(issue.path);
      const text = localizeAdminIssue(locale, issue, path);
      const head = path[0];
      const field = head === 'seriesSlug' ? 'series' : head;
      if (isAttributeCapIssue(path, issue)) {
        fields.attributes = fields.attributes ? `${fields.attributes}\n${text}` : text;
      } else if (field && head && path.length === 1 && KNOWN_FIELDS.has(head)) {
        fields[field] = fields[field] ? `${fields[field]}\n${text}` : text;
      } else if (path.length > 0) {
        extras.push(`${path.join('.')}: ${text}`);
      } else {
        extras.push(text);
      }
    }
    return { fields, message: extras.length > 0 ? extras.join('\n') : null };
  }

  const raw = failure.message.trim();
  if (raw && raw !== failure.trpcCode) {
    return { fields: {}, message: t(locale, 'admin.error.unknown', { message: raw }) };
  }
  return { fields: {}, message: t(locale, fallbackKey) };
}

export function applyValidationFeedback(
  locale: Locale,
  error: unknown,
  fallbackKey: string,
  renderedFields: readonly string[],
): ValidationFeedback {
  const feedback = readValidationFeedback(locale, error, fallbackKey);
  const fields: Record<string, string> = {};
  const extras: string[] = [];
  for (const [key, value] of Object.entries(feedback.fields)) {
    if (renderedFields.includes(key)) fields[key] = value;
    else extras.push(value);
  }
  const parts = [feedback.message, ...extras].filter((part): part is string => Boolean(part));
  return { fields, message: parts.length > 0 ? parts.join('\n') : null };
}

export function isAllowedImageUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || trimmed.startsWith('https://') || trimmed.startsWith('gradient:');
}

export function validateSlug(value: string, locale: Locale): string | null {
  const trimmed = value.trim();
  if (!trimmed) return t(locale, 'admin.error.required');
  if (!slugSchema.safeParse(trimmed).success) return t(locale, 'admin.error.slugFormat');
  return null;
}

export function validateRequiredText(value: string, max: number, locale: Locale): string | null {
  const trimmed = value.trim();
  if (!trimmed) return t(locale, 'admin.error.required');
  if (value.length > max) return t(locale, 'admin.error.tooLong');
  return null;
}

export function validateOptionalText(value: string, max: number, locale: Locale): string | null {
  if (value.length > max) return t(locale, 'admin.error.tooLong');
  return null;
}

function scanJsonError(text: string): number {
  let index = 0;

  const skipWhitespace = () => {
    while (index < text.length && /\s/.test(text[index] ?? '')) index += 1;
  };

  const parseValue = (): boolean => {
    skipWhitespace();
    const char = text[index];
    if (char === '{') return parseObject();
    if (char === '[') return parseArray();
    if (char === '"') return parseString();
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) return parseNumber();
    if (text.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (text.startsWith('false', index)) {
      index += 5;
      return true;
    }
    if (text.startsWith('null', index)) {
      index += 4;
      return true;
    }
    return false;
  };

  const parseString = (): boolean => {
    if (text[index] !== '"') return false;
    index += 1;
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index += 1;
        return true;
      }
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char !== undefined && char < ' ') return false;
      index += 1;
    }
    return false;
  };

  const parseNumber = (): boolean => {
    const start = index;
    if (text[index] === '-') index += 1;
    const digit = text[index];
    if (digit === '0') index += 1;
    else if (digit !== undefined && digit >= '1' && digit <= '9') {
      while ((text[index] ?? '') >= '0' && (text[index] ?? '') <= '9') index += 1;
    } else return false;
    if (text[index] === '.') {
      index += 1;
      if (!((text[index] ?? '') >= '0' && (text[index] ?? '') <= '9')) return false;
      while ((text[index] ?? '') >= '0' && (text[index] ?? '') <= '9') index += 1;
    }
    if (text[index] === 'e' || text[index] === 'E') {
      index += 1;
      if (text[index] === '+' || text[index] === '-') index += 1;
      if (!((text[index] ?? '') >= '0' && (text[index] ?? '') <= '9')) return false;
      while ((text[index] ?? '') >= '0' && (text[index] ?? '') <= '9') index += 1;
    }
    return index > start;
  };

  const parseObject = (): boolean => {
    index += 1;
    skipWhitespace();
    if (text[index] === '}') {
      index += 1;
      return true;
    }
    while (index < text.length) {
      if (!parseString()) return false;
      skipWhitespace();
      if (text[index] !== ':') return false;
      index += 1;
      if (!parseValue()) return false;
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        return true;
      }
      if (text[index] !== ',') return false;
      index += 1;
      skipWhitespace();
    }
    return false;
  };

  const parseArray = (): boolean => {
    index += 1;
    skipWhitespace();
    if (text[index] === ']') {
      index += 1;
      return true;
    }
    while (index < text.length) {
      if (!parseValue()) return false;
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return true;
      }
      if (text[index] !== ',') return false;
      index += 1;
      skipWhitespace();
    }
    return false;
  };

  if (!parseValue()) return index;
  skipWhitespace();
  return index;
}

function jsonErrorIndex(text: string, message: string): number | null {
  const position = /position\s+(\d+)/i.exec(message);
  if (position) {
    const index = Number(position[1]);
    if (Number.isFinite(index) && index >= 0) return index;
  }
  const line = /line\s+(\d+)/i.exec(message);
  if (line && !message.includes('is not valid JSON')) {
    const lineNumber = Number(line[1]);
    if (Number.isFinite(lineNumber) && lineNumber > 0) {
      let current = 1;
      for (let index = 0; index < text.length; index += 1) {
        if (current === lineNumber) return index;
        if (text[index] === '\n') current += 1;
      }
      return text.length;
    }
  }
  return scanJsonError(text);
}

export function jsonErrorLine(text: string, message: string): number {
  const index = jsonErrorIndex(text, message);
  if (index === null) return 1;
  const clamped = Math.min(Math.max(index, 0), text.length);
  return text.slice(0, clamped).split('\n').length;
}

export function summarizeImport(rows: ImportRowResult[]) {
  const count = (status: ImportStatus, type?: 'series' | 'card') =>
    rows.filter((row) => row.status === status && (type === undefined || row.row.type === type))
      .length;
  return {
    newSeries: count('created', 'series'),
    newCards: count('created', 'card'),
    updSeries: count('updated', 'series'),
    updCards: count('updated', 'card'),
    errors: count('error'),
    create: count('created'),
    update: count('updated'),
  };
}

export function displayImportNames(
  data: unknown,
  row: ImportRowResult['row'],
  errors: Array<{ path: string }>,
): { slug: string; name: string } {
  let slug = row.slug ?? '';
  let name = row.name ?? '';
  if (row.slug && row.name) return { slug: row.slug, name: row.name };
  const path = errors.find((error) => error.path.includes('series['))?.path ?? errors[0]?.path;
  if (!path || !Array.isArray(data)) return { slug, name };
  const seriesIndex = Number(/series\[(\d+)\]/.exec(path)?.[1]);
  const cardIndexMatch = /cards\[(\d+)\]/.exec(path);
  const series = data[seriesIndex];
  if (!series || typeof series !== 'object') return { slug, name };
  const seriesRecord = series as Record<string, unknown>;
  if (!cardIndexMatch) {
    if (!slug && typeof seriesRecord.slug === 'string') slug = seriesRecord.slug;
    if (!name && typeof seriesRecord.title === 'string') name = seriesRecord.title;
    return { slug, name };
  }
  const cards = seriesRecord.cards;
  const card = Array.isArray(cards) ? cards[Number(cardIndexMatch[1])] : undefined;
  if (!card || typeof card !== 'object') return { slug, name };
  const cardRecord = card as Record<string, unknown>;
  if (!slug && typeof cardRecord.slug === 'string') slug = cardRecord.slug;
  if (!name && typeof cardRecord.name === 'string') name = cardRecord.name;
  return { slug, name };
}

export type AttributeType = 'string' | 'number' | 'boolean';

export interface AttributeRow {
  id: string;
  key: string;
  type: AttributeType;
  value: string;
}

let attributeSeed = 0;

export function createAttributeRow(): AttributeRow {
  attributeSeed += 1;
  return { id: `attr-${attributeSeed}`, key: '', type: 'string', value: '' };
}

export function attributesToRows(
  attributes: Record<string, string | number | boolean>,
): AttributeRow[] {
  return Object.entries(attributes).map(([key, value]) => {
    attributeSeed += 1;
    const type: AttributeType =
      typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
    return {
      id: `attr-${attributeSeed}`,
      key,
      type,
      value: type === 'boolean' ? (value ? 'true' : 'false') : String(value),
    };
  });
}

export function validateAttributeRows(
  rows: AttributeRow[],
  locale: Locale,
):
  | { ok: true; attributes: Record<string, string | number | boolean> }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const seen = new Map<string, string>();
  const attributes: Record<string, string | number | boolean> = {};

  for (const row of rows) {
    const key = row.key.trim();
    const textValue = row.value.trim();
    const blankValue = row.type === 'boolean' ? false : textValue === '';
    if (!key && blankValue) continue;
    if (!key) {
      errors[row.id] = t(locale, 'admin.attrs.errorKey');
      continue;
    }
    if (key.length > ADMIN_ATTRIBUTE_KEY_MAX) {
      errors[row.id] = t(locale, 'admin.attrs.errorKeyLength', { max: ADMIN_ATTRIBUTE_KEY_MAX });
      continue;
    }
    const lowered = key.toLowerCase();
    const firstId = seen.get(lowered);
    if (firstId) {
      errors[row.id] = t(locale, 'admin.attrs.errorDuplicate');
      errors[firstId] = t(locale, 'admin.attrs.errorDuplicate');
      continue;
    }
    seen.set(lowered, row.id);
    if (row.type === 'number') {
      if (!textValue || !Number.isFinite(Number(textValue))) {
        errors[row.id] = t(locale, 'admin.attrs.errorNumber');
        continue;
      }
      attributes[key] = Number(textValue);
    } else if (row.type === 'boolean') {
      attributes[key] = row.value === 'true';
    } else {
      if (row.value.length > ADMIN_ATTRIBUTE_VALUE_MAX) {
        errors[row.id] = t(locale, 'admin.attrs.errorValueLength', {
          max: ADMIN_ATTRIBUTE_VALUE_MAX,
        });
        continue;
      }
      attributes[key] = row.value;
    }
  }

  if (
    Object.keys(errors).length === 0 &&
    Object.keys(attributes).length > ADMIN_ATTRIBUTE_MAX_KEYS
  ) {
    const last = [...rows].reverse().find((row) => row.key.trim());
    if (last) {
      errors[last.id] = t(locale, 'admin.attrs.errorTooMany', { max: ADMIN_ATTRIBUTE_MAX_KEYS });
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, attributes };
}

export const IMPORT_EXAMPLE = `[
  {
    "slug": "celestial-dawn",
    "title": "天穹黎明",
    "description": "故事开端的限定系列",
    "coverUrl": "gradient:from-sky-400-via-indigo-400-to-purple-500",
    "cards": [
      {
        "slug": "aurora-knight",
        "name": "极光骑士",
        "description": "身披极光鳞甲的天穹守护者",
        "rarity": "legendary",
        "imageUrl": "https://example.com/aurora-knight.png",
        "attributes": { "cost": 8, "type": "随从" }
      }
    ]
  }
]`;

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

export function formatUpdatedAt(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}
