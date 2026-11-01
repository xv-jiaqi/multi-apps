import { RELEASE_CURSOR_MAX, parseShanghaiCivilDate } from '@repo/shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opaque keyset cursor. The payload is the civil date and the id, so a deleted
 * row still has a position. The list direction is not stored: each list applies
 * its own order when it reads the cursor.
 */
export function encodeReleaseCursor(releaseDate: string, id: string): string {
  return Buffer.from(`${releaseDate}|${id}`, 'utf8').toString('base64url');
}

export function decodeReleaseCursor(cursor: string): { releaseDate: string; id: string } | null {
  if (cursor.length < 1 || cursor.length > RELEASE_CURSOR_MAX) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (Buffer.from(text, 'utf8').toString('base64url') !== cursor) return null;
  const separator = text.indexOf('|');
  if (separator !== 10) return null;
  const releaseDate = text.slice(0, separator);
  const id = text.slice(separator + 1);
  if (!parseShanghaiCivilDate(releaseDate)) return null;
  if (!UUID_PATTERN.test(id)) return null;
  return { releaseDate, id };
}
