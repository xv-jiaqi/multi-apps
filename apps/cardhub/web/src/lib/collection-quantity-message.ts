import { fieldErrorMessage, type Locale } from '@repo/shared';

const OWNED_COUNT_ZOD_CODES = new Set(['too_small', 'too_big', 'invalid_type']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readZodError(error: unknown): Record<string, unknown> | null {
  if (!isRecord(error) || !isRecord(error.data)) return null;
  return isRecord(error.data.zodError) ? error.data.zodError : null;
}

function isOwnedCountZodCode(value: unknown): boolean {
  return typeof value === 'string' && OWNED_COUNT_ZOD_CODES.has(value);
}

/**
 * Quantity copy for a collection write or list error.
 * `collection_quantity` is the field code wherever it appears.
 * `too_small` / `too_big` / `invalid_type` count only on path `ownedCount`,
 * because the API's top-level message is the generic validation sentence.
 */
function hasCollectionQuantitySignal(error: unknown): boolean {
  const zodError = readZodError(error);
  if (!zodError) return false;

  if (Array.isArray(zodError.issues)) {
    for (const issue of zodError.issues) {
      if (!isRecord(issue)) continue;
      const path = Array.isArray(issue.path) ? issue.path : [];
      const onOwnedCount = path[0] === 'ownedCount';
      if (issue.message === 'collection_quantity' || issue.code === 'collection_quantity') {
        return true;
      }
      if (onOwnedCount && (isOwnedCountZodCode(issue.message) || isOwnedCountZodCode(issue.code))) {
        return true;
      }
    }
  }

  const fieldErrors = zodError.fieldErrors;
  if (!isRecord(fieldErrors)) return false;
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item === 'collection_quantity') return true;
      if (key === 'ownedCount' && isOwnedCountZodCode(item)) return true;
    }
  }
  return false;
}

export function collectionQuantityMessage(locale: Locale, error: unknown): string | null {
  if (!hasCollectionQuantitySignal(error)) return null;
  return fieldErrorMessage(locale, 'collection_quantity');
}
