import { createHash, randomBytes } from 'node:crypto';

export const PASSWORD_RESET_TTL_MS = 15 * 60_000;
export const PASSWORD_RESET_TOKEN_BYTES = 32;

export function createPasswordResetToken(): string {
  return randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('base64url');
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function passwordResetExpiresAt(now: Date): Date {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
}
