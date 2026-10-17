/** Hard cap for one `admin.catalog.import` call. Series and card objects each count as one row. */
export const CATALOG_IMPORT_MAX_ROWS = 500;

/** Hard cap for one import request body, in UTF-8 bytes (1 MiB). */
export const CATALOG_IMPORT_MAX_BYTES = 1024 * 1024;

/**
 * UTF-8 byte length without `TextEncoder` / `Buffer`, so this stays usable
 * from the shared package (ES2023 lib only) and from a future import page.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rows are the series objects in `data` plus each card nested under `cards`.
 * A non-array payload is not a row list (the importer reports that separately).
 */
export function countCatalogImportRows(data: unknown): number {
  if (!Array.isArray(data)) return 0;
  let count = data.length;
  for (const series of data) {
    if (!isRecord(series) || !Array.isArray(series.cards)) continue;
    count += series.cards.length;
  }
  return count;
}

export type CatalogImportLimitViolation =
  | { reason: 'tooLarge' }
  | { reason: 'tooManyRows'; count: number };

/**
 * Checks the serialized procedure input (the JSON body tRPC will validate)
 * before zod runs. Byte size is `JSON.stringify` UTF-8 length, which matches
 * a compact request body.
 */
export function catalogImportLimit(input: unknown): CatalogImportLimitViolation | null {
  const serialized = JSON.stringify(input);
  if (typeof serialized === 'string' && utf8ByteLength(serialized) > CATALOG_IMPORT_MAX_BYTES) {
    return { reason: 'tooLarge' };
  }
  const data = isRecord(input) ? input.data : undefined;
  const count = countCatalogImportRows(data);
  if (count > CATALOG_IMPORT_MAX_ROWS) {
    return { reason: 'tooManyRows', count };
  }
  return null;
}
