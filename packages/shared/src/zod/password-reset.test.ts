import { describe, expect, it } from 'vitest';
import { requestPasswordResetInput, resetPasswordInput } from './index';

describe('requestPasswordResetInput', () => {
  it('trims and lowercases the email the same way register does', () => {
    const parsed = requestPasswordResetInput.parse({ email: '  A@B.CO ' });
    expect(parsed).toEqual({ email: 'a@b.co' });
  });

  it('rejects a missing or invalid email', () => {
    expect(requestPasswordResetInput.safeParse({}).success).toBe(false);
    expect(requestPasswordResetInput.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
});

describe('resetPasswordInput', () => {
  it('reuses the register / changePassword password rules', () => {
    const parsed = resetPasswordInput.parse({
      token: '  abc  ',
      newPassword: 'long-enough',
    });
    expect(parsed).toEqual({ token: 'abc', newPassword: 'long-enough' });
  });

  it('rejects a blank token or a short password', () => {
    expect(resetPasswordInput.safeParse({ token: '   ', newPassword: 'long-enough' }).success).toBe(
      false,
    );
    expect(resetPasswordInput.safeParse({ token: 'abc', newPassword: 'short' }).success).toBe(
      false,
    );
  });
});
