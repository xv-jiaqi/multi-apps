import {
  PASSWORD_RESET_TTL_MS,
  createPasswordResetToken,
  hashPasswordResetToken,
  passwordResetExpiresAt,
} from './password-reset-token';

describe('password reset tokens', () => {
  it('creates a unique url-safe token and stores only a sha256 hex digest', () => {
    const token = createPasswordResetToken();
    const other = createPasswordResetToken();
    expect(token).not.toBe(other);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
    const digest = hashPasswordResetToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token);
    expect(hashPasswordResetToken(token)).toBe(digest);
    expect(hashPasswordResetToken(other)).not.toBe(digest);
  });

  it('expires 15 minutes after the given time', () => {
    const now = new Date('2026-11-18T04:00:00.000Z');
    expect(passwordResetExpiresAt(now).getTime()).toBe(now.getTime() + PASSWORD_RESET_TTL_MS);
    expect(PASSWORD_RESET_TTL_MS).toBe(15 * 60_000);
  });
});
