import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Stored hashes from this helper start with this prefix. Older rows are a
 * bare bcrypt hash (`$2a$` / `$2b$`), so the two formats stay distinguishable
 * without a schema change.
 */
export const NEW_PASSWORD_HASH_PREFIX = 'sha256$';

const BCRYPT_ROUNDS = 10;
const BCRYPT_MAX_BYTES = 72;

/**
 * bcrypt only reads the first 72 bytes and stops at a NUL. Hash the whole
 * password, then base64-encode the digest so the bcrypt input cannot contain
 * a NUL and is shorter than 72 bytes.
 */
function bcryptMaterial(password: string): string {
  return createHash('sha256').update(password, 'utf8').digest('base64');
}

export function isNewPasswordHash(stored: string): boolean {
  return stored.startsWith(NEW_PASSWORD_HASH_PREFIX);
}

/** Legacy bcrypt only stored the first 72 UTF-8 bytes. */
export function legacyPasswordExceedsBcryptLimit(stored: string, password: string): boolean {
  return !isNewPasswordHash(stored) && Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_BYTES;
}

export async function hashPassword(
  password: string,
  options: { prehash?: boolean } = {},
): Promise<string> {
  if (!options.prehash) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }
  const hashed = await bcrypt.hash(bcryptMaterial(password), BCRYPT_ROUNDS);
  return `${NEW_PASSWORD_HASH_PREFIX}${hashed}`;
}

export type PasswordCheck =
  | { ok: true; upgradedHash: string | null }
  | { ok: false; upgradedHash: null };

/**
 * Shared check for login and changePassword. A new-format hash is verified
 * against the pre-hash. A legacy hash is verified with plain bcrypt. When
 * `upgrade` is set, the legacy check succeeds, and the password is at most
 * 72 UTF-8 bytes, `upgradedHash` is the new-format value the caller must
 * store. A longer password is not upgraded: bcrypt only stored the first 72
 * bytes, so the matching input may not be the owner's real password.
 * Callers leave `upgrade` off unless `PASSWORD_PREHASH_WRITE` is the exact
 * string "true".
 */
export async function verifyPassword(
  password: string,
  stored: string,
  options: { upgrade?: boolean } = {},
): Promise<PasswordCheck> {
  if (isNewPasswordHash(stored)) {
    const hashed = stored.slice(NEW_PASSWORD_HASH_PREFIX.length);
    const ok = await bcrypt.compare(bcryptMaterial(password), hashed);
    return ok ? { ok: true, upgradedHash: null } : { ok: false, upgradedHash: null };
  }

  const ok = await bcrypt.compare(password, stored);
  if (!ok) return { ok: false, upgradedHash: null };
  if (!options.upgrade || Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_BYTES) {
    return { ok: true, upgradedHash: null };
  }
  return { ok: true, upgradedHash: await hashPassword(password, { prehash: true }) };
}
