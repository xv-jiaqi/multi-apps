import { isMailConfigured, readMailConfig } from './mail.config';

describe('readMailConfig', () => {
  it('treats missing, blank, and explicit-off providers as unconfigured', () => {
    expect(readMailConfig({})).toBeUndefined();
    expect(readMailConfig({ MAIL_PROVIDER: '' })).toBeUndefined();
    expect(readMailConfig({ MAIL_PROVIDER: '  ' })).toBeUndefined();
    expect(readMailConfig({ MAIL_PROVIDER: 'off', RESEND_API_KEY: 're_test' })).toBeUndefined();
    expect(readMailConfig({ MAIL_PROVIDER: 'NONE' })).toBeUndefined();
    expect(readMailConfig({ MAIL_PROVIDER: 'false' })).toBeUndefined();
    expect(readMailConfig({ MAIL_PROVIDER: '0' })).toBeUndefined();
    expect(isMailConfigured({})).toBe(false);
  });

  it('requires a Resend API key when the provider is resend', () => {
    expect(readMailConfig({ MAIL_PROVIDER: 'resend' })).toBeUndefined();
    expect(readMailConfig({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: '  ' })).toBeUndefined();
    expect(readMailConfig({ MAIL_PROVIDER: 'RESEND', RESEND_API_KEY: ' re_test ' })).toEqual({
      provider: 'resend',
      apiKey: 're_test',
    });
  });

  it('requires host, a valid port, and from for SMTP', () => {
    const base = { MAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'a@b.c' };
    expect(readMailConfig(base)).toBeUndefined();
    expect(readMailConfig({ ...base, SMTP_PORT: 'abc' })).toBeUndefined();
    expect(readMailConfig({ ...base, SMTP_PORT: '0' })).toBeUndefined();
    expect(readMailConfig({ ...base, SMTP_PORT: '587' })).toEqual({
      provider: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      from: 'a@b.c',
    });
    expect(
      readMailConfig({
        ...base,
        SMTP_PORT: '465',
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
      }),
    ).toEqual({
      provider: 'smtp',
      host: 'smtp.example.com',
      port: 465,
      from: 'a@b.c',
      user: 'user',
      pass: 'pass',
    });
  });

  it('enables the memory provider only during tests', () => {
    expect(readMailConfig({ MAIL_PROVIDER: 'memory' })).toBeUndefined();
    expect(readMailConfig({ MAIL_PROVIDER: 'memory', NODE_ENV: 'production' })).toBeUndefined();
    expect(readMailConfig({ MAIL_PROVIDER: 'memory', NODE_ENV: 'test' })).toEqual({
      provider: 'memory',
    });
  });

  it('rejects an unknown provider even when other mail variables are set', () => {
    expect(
      readMailConfig({
        MAIL_PROVIDER: 'sendgrid',
        RESEND_API_KEY: 're_test',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_FROM: 'a@b.c',
      }),
    ).toBeUndefined();
  });
});
