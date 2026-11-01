const KEYSET_BYTES = 24;
const TIMESTAMP_BYTES = 8;

/**
 * Opaque list cursor for (createdAt desc, id desc). 24 bytes encode to 32
 * base64url characters, inside the shared 36-character cursor cap.
 */
export function encodeNotificationCursor(createdAt: Date, id: string): string | null {
  const idBytes = uuidBytes(id);
  if (!idBytes) return null;
  const millis = createdAt.getTime();
  if (!Number.isSafeInteger(millis) || millis < 0) return null;
  const buf = Buffer.alloc(KEYSET_BYTES);
  buf.writeBigUInt64BE(BigInt(millis), 0);
  idBytes.copy(buf, TIMESTAMP_BYTES);
  return buf.toString('base64url');
}

export function decodeNotificationCursor(cursor: string): { createdAt: Date; id: string } | null {
  if (cursor.length !== 32) return null;
  const buf = Buffer.from(cursor, 'base64url');
  if (buf.length !== KEYSET_BYTES) return null;
  const millis = buf.readBigUInt64BE(0);
  if (millis > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const createdAt = new Date(Number(millis));
  if (Number.isNaN(createdAt.getTime())) return null;
  const hex = buf.subarray(TIMESTAMP_BYTES).toString('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!uuidBytes(id)) return null;
  return { createdAt, id };
}

function uuidBytes(id: string): Buffer | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  const bytes = Buffer.from(id.replaceAll('-', ''), 'hex');
  return bytes.length === 16 ? bytes : null;
}
