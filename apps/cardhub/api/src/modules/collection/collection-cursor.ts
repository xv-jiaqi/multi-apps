const KEYSET_BYTES = 24;
const TIMESTAMP_BYTES = 8;

/**
 * Opaque list cursor. It stores the page boundary (updatedAt, id) so the next
 * page does not look the row up again. A deleted row, or a row whose
 * updatedAt moved, still has a stable boundary.
 * 24 bytes encode to 32 base64url characters, inside the shared 36-char cap.
 */
export function encodeCollectionCursor(updatedAt: Date, id: string): string {
  const idBytes = uuidBytes(id);
  if (!idBytes) {
    throw new Error('collection cursor id is not a uuid');
  }
  const buf = Buffer.alloc(KEYSET_BYTES);
  buf.writeBigUInt64BE(BigInt(updatedAt.getTime()), 0);
  idBytes.copy(buf, TIMESTAMP_BYTES);
  return buf.toString('base64url');
}

export function decodeCollectionCursor(cursor: string): { updatedAt: Date; id: string } | null {
  if (cursor.length !== 32) return null;
  const buf = Buffer.from(cursor, 'base64url');
  if (buf.length !== KEYSET_BYTES) return null;
  const millis = buf.readBigUInt64BE(0);
  if (millis > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const updatedAt = new Date(Number(millis));
  if (Number.isNaN(updatedAt.getTime())) return null;
  const hex = buf.subarray(TIMESTAMP_BYTES).toString('hex');
  return {
    updatedAt,
    id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  };
}

function uuidBytes(id: string): Buffer | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  return Buffer.from(id.replaceAll('-', ''), 'hex');
}
