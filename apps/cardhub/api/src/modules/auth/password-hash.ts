import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Stored hashes from this helper start with this prefix. Older rows are a
 * bare bcrypt hash (`$2a$` / `$2b$`), so the two formats stay distinguishable
 * without a schema change.
 */
export const NEW_PASSWORD_HASH_PREFIX = 'sha256$';

const BCRYPT_ROUNDS = 10;

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

export async function hashPassword(password: string): Promise<string> {
  const hashed = await bcrypt.hash(bcryptMaterial(password), BCRYPT_ROUNDS);
  return `${NEW_PASSWORD_HASH_PREFIX}${hashed}`;
}

export type PasswordCheck =
  | { ok: true; upgradedHash: string | null }
  | { ok: false; upgradedHash: null };

/**
 * Shared check for login and changePassword. A new-format hash is verified
 * against the pre-hash. A legacy hash is verified with plain bcrypt and, on
 * success, `upgradedHash` is the value the caller must store.
 */
export async function verifyPassword(password: string, stored: string): Promise<PasswordCheck> {
  if (isNewPasswordHash(stored)) {
    const hashed = stored.slice(NEW_PASSWORD_HASH_PREFIX.length);
    const ok = await bcrypt.compare(bcryptMaterial(password), hashed);
    return ok ? { ok: true, upgradedHash: null } : { ok: false, upgradedHash: null };
  }

  const ok = await bcrypt.compare(password, stored);
  if (!ok) return { ok: false, upgradedHash: null };
  return { ok: true, upgradedHash: await hashPassword(password) };
}
