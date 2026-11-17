import {
  type AdminCatalogErrorCode,
  CARD_NUMBER_MAX,
  SUBSET_KIND_VALUES,
  type SubsetKindValue,
  releaseDateSchema,
  slugSchema,
} from '@repo/shared';
import { z } from 'zod';

/**
 * Keys `admin.catalog.import` reads (CH-234). Any other key is a row error
 * `UNKNOWN_FIELD`, so a typo such as `cardNo` is not silently dropped.
 */
export const SERIES_IMPORT_FIELDS: ReadonlySet<string> = new Set([
  'slug',
  'title',
  'description',
  'coverUrl',
  'categorySlug',
  'releaseDate',
  'subsets',
  'cards',
]);

export const CARD_IMPORT_FIELDS: ReadonlySet<string> = new Set([
  'slug',
  'name',
  'description',
  'rarity',
  'imageUrl',
  'attributes',
  'cardNumber',
  'subsetSlug',
  'parallelOf',
  'parallelName',
  'printRun',
]);

export const SUBSET_IMPORT_FIELDS: ReadonlySet<string> = new Set([
  'slug',
  'name',
  'kind',
  'sortOrder',
]);

export interface ImportFieldError {
  path: string;
  code: AdminCatalogErrorCode;
}

export interface NormalizedSubset {
  slug: string;
  name: string;
  kind: SubsetKindValue;
  /** Omitted keeps the stored order on update and stores 0 on create. */
  sortOrder?: number;
}

/** Empty string clears the link. A non-empty value must be a slug. */
const importSlugOrEmpty = z.union([slugSchema, z.literal('')]);
/** Whitespace-only is the empty string: it clears the stored date. */
const importReleaseDate = z
  .string()
  .trim()
  .pipe(z.union([z.literal(''), releaseDateSchema]));
const importCardNumber = z.string().trim().max(CARD_NUMBER_MAX);
const importSubsetName = z.string().trim().min(1).max(120);
const importSubsetKind = z.enum(SUBSET_KIND_VALUES);
const importSortOrder = z.number().int().min(-2_147_483_648).max(2_147_483_647);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function reportUnknownFields(
  raw: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  errors: ImportFieldError[],
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) errors.push({ path: `${path}.${key}`, code: 'UNKNOWN_FIELD' });
  }
}

/**
 * Reads one optional string field with a zod schema. Absent returns
 * undefined (leave the stored value). A non-string is INVALID_TYPE; a string
 * the schema rejects gets `invalidCode`. Zod messages never reach the row.
 */
function readStringField<T>(
  raw: Record<string, unknown>,
  key: string,
  schema: z.ZodType<T>,
  invalidCode: AdminCatalogErrorCode,
  path: string,
  errors: ImportFieldError[],
): T | undefined {
  if (!(key in raw)) return undefined;
  const value = raw[key];
  if (typeof value !== 'string') {
    errors.push({ path: `${path}.${key}`, code: 'INVALID_TYPE' });
    return undefined;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    errors.push({ path: `${path}.${key}`, code: invalidCode });
    return undefined;
  }
  return parsed.data;
}

export interface SeriesTaxonomyFields {
  /** Undefined leaves the stored category. Empty string clears it. */
  categorySlug?: string;
  /** Undefined leaves the stored date. Empty string clears it. */
  releaseDate?: string;
  subsets: NormalizedSubset[];
}

export function readSeriesTaxonomy(
  raw: Record<string, unknown>,
  seriesPath: string,
  errors: ImportFieldError[],
): SeriesTaxonomyFields {
  const categorySlug = readStringField(
    raw,
    'categorySlug',
    importSlugOrEmpty,
    'SLUG_FORMAT',
    seriesPath,
    errors,
  );
  const releaseDate = readStringField(
    raw,
    'releaseDate',
    importReleaseDate,
    'INVALID_DATE',
    seriesPath,
    errors,
  );
  const subsets: NormalizedSubset[] = [];
  if ('subsets' in raw) {
    const rawSubsets = raw.subsets;
    if (!Array.isArray(rawSubsets)) {
      errors.push({ path: `${seriesPath}.subsets`, code: 'INVALID_TYPE' });
    } else {
      const seen = new Set<string>();
      rawSubsets.forEach((rawSubset: unknown, index) => {
        const subset = readSubset(rawSubset, `${seriesPath}.subsets[${index}]`, seen, errors);
        if (subset) subsets.push(subset);
      });
    }
  }
  return {
    ...(categorySlug !== undefined ? { categorySlug } : {}),
    ...(releaseDate !== undefined ? { releaseDate } : {}),
    subsets,
  };
}

function readSubset(
  raw: unknown,
  path: string,
  seen: Set<string>,
  errors: ImportFieldError[],
): NormalizedSubset | null {
  if (!isRecord(raw)) {
    errors.push({ path, code: 'INVALID_TYPE' });
    return null;
  }
  const before = errors.length;
  reportUnknownFields(raw, SUBSET_IMPORT_FIELDS, path, errors);

  let slug: string | undefined;
  if (raw.slug === undefined || raw.slug === '') {
    errors.push({ path: `${path}.slug`, code: 'REQUIRED' });
  } else {
    slug = readStringField(raw, 'slug', slugSchema, 'SLUG_FORMAT', path, errors);
    if (slug !== undefined && seen.has(slug)) {
      errors.push({ path: `${path}.slug`, code: 'SLUG_DUPLICATE_IN_FILE' });
      slug = undefined;
    }
  }

  let name: string | undefined;
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    errors.push({
      path: `${path}.name`,
      code: raw.name === undefined || typeof raw.name === 'string' ? 'REQUIRED' : 'INVALID_TYPE',
    });
  } else {
    name = readStringField(raw, 'name', importSubsetName, 'TOO_LONG', path, errors);
  }

  let kind: SubsetKindValue | undefined;
  if (raw.kind === undefined) {
    errors.push({ path: `${path}.kind`, code: 'REQUIRED' });
  } else {
    const parsed = importSubsetKind.safeParse(raw.kind);
    if (parsed.success) kind = parsed.data;
    else errors.push({ path: `${path}.kind`, code: 'INVALID_TYPE' });
  }

  let sortOrder: number | undefined;
  if ('sortOrder' in raw) {
    const parsed = importSortOrder.safeParse(raw.sortOrder);
    if (parsed.success) sortOrder = parsed.data;
    else errors.push({ path: `${path}.sortOrder`, code: 'INVALID_TYPE' });
  }

  if (slug !== undefined) seen.add(slug);
  if (errors.length > before || slug === undefined || name === undefined || kind === undefined) {
    return null;
  }
  return { slug, name, kind, ...(sortOrder !== undefined ? { sortOrder } : {}) };
}

export interface CardTaxonomyFields {
  /** Undefined leaves the stored number. Empty after trim clears it. */
  cardNumber?: string | null;
  /** Undefined leaves the stored subset. Empty string clears it. */
  subsetSlug?: string;
}

export function readCardTaxonomy(
  raw: Record<string, unknown>,
  cardPath: string,
  errors: ImportFieldError[],
): CardTaxonomyFields {
  const cardNumber = readStringField(
    raw,
    'cardNumber',
    importCardNumber,
    'TOO_LONG',
    cardPath,
    errors,
  );
  const subsetSlug = readStringField(
    raw,
    'subsetSlug',
    importSlugOrEmpty,
    'SLUG_FORMAT',
    cardPath,
    errors,
  );
  return {
    ...(cardNumber !== undefined ? { cardNumber: cardNumber.length > 0 ? cardNumber : null } : {}),
    ...(subsetSlug !== undefined ? { subsetSlug } : {}),
  };
}
