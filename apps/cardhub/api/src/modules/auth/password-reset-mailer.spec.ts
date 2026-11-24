import { readMailConfig } from './mail.config';
import {
  clearMemoryPasswordResetMails,
  memoryPasswordResetMails,
  resolvePasswordResetMailer,
  sendPasswordResetToMemory,
} from './password-reset-mailer';

describe('resolvePasswordResetMailer', () => {
  afterEach(() => {
    clearMemoryPasswordResetMails();
  });

  it('prefers an injected mailer over the env provider', async () => {
    const override = { sendPasswordReset: jest.fn() };
    const resolved = resolvePasswordResetMailer(
      { MAIL_PROVIDER: 'memory', NODE_ENV: 'test' },
      override,
    );
    expect(resolved).toBe(override);
  });

  it('uses the memory mailbox only when that provider is configured', async () => {
    expect(resolvePasswordResetMailer({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're' })).toBe(
      undefined,
    );
    const resolved = resolvePasswordResetMailer({ MAIL_PROVIDER: 'memory', NODE_ENV: 'test' });
    expect(resolved).toBeDefined();
    if (!resolved) return;
    const mail = {
      to: 'alice@cardhub.test',
      token: 'plain',
      expiresAt: new Date('2026-11-18T04:15:00.000Z'),
    };
    await resolved.sendPasswordReset(mail);
    expect(memoryPasswordResetMails()).toEqual([mail]);
  });

  it('records memory mail through the dedicated sender', async () => {
    expect(readMailConfig({ MAIL_PROVIDER: 'memory', NODE_ENV: 'test' })?.provider).toBe('memory');
    await sendPasswordResetToMemory({
      to: 'a@b.c',
      token: 't',
      expiresAt: new Date('2026-11-18T04:15:00.000Z'),
    });
    expect(memoryPasswordResetMails()).toHaveLength(1);
    clearMemoryPasswordResetMails();
    expect(memoryPasswordResetMails()).toHaveLength(0);
  });
});
