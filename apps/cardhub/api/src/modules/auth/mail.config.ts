export const MAIL_PROVIDER_ENV = 'MAIL_PROVIDER';

const DISABLED_PROVIDERS = new Set(['', 'off', 'none', 'false', '0']);

export type MailProvider = 'resend' | 'smtp' | 'memory';

export type ResendMailConfig = {
  provider: 'resend';
  apiKey: string;
};

export type SmtpMailConfig = {
  provider: 'smtp';
  host: string;
  port: number;
  from: string;
  user?: string;
  pass?: string;
};

export type MemoryMailConfig = {
  provider: 'memory';
};

export type MailConfig = ResendMailConfig | SmtpMailConfig | MemoryMailConfig;

type EnvMap = Readonly<Record<string, string | undefined>>;

function readTrimmed(env: EnvMap, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function providerName(env: EnvMap): string {
  return (env[MAIL_PROVIDER_ENV] ?? '').trim().toLowerCase();
}

function smtpPort(value: string): number | undefined {
  if (!/^[0-9]+$/.test(value)) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return port;
}

/**
 * Mail is configured only when MAIL_PROVIDER is a known provider and that
 * provider's required variables are present. Empty, "off", "none", "false",
 * or "0" is an explicit off switch. `memory` is only available when
 * NODE_ENV=test.
 */
export function readMailConfig(env: EnvMap): MailConfig | undefined {
  const provider = providerName(env);
  if (DISABLED_PROVIDERS.has(provider)) return undefined;

  if (provider === 'resend') {
    const apiKey = readTrimmed(env, 'RESEND_API_KEY');
    if (!apiKey) return undefined;
    return { provider: 'resend', apiKey };
  }

  if (provider === 'smtp') {
    const host = readTrimmed(env, 'SMTP_HOST');
    const portValue = readTrimmed(env, 'SMTP_PORT');
    const from = readTrimmed(env, 'SMTP_FROM');
    if (!host || !portValue || !from) return undefined;
    const port = smtpPort(portValue);
    if (port === undefined) return undefined;
    const user = readTrimmed(env, 'SMTP_USER');
    const pass = readTrimmed(env, 'SMTP_PASS');
    return {
      provider: 'smtp',
      host,
      port,
      from,
      ...(user ? { user } : {}),
      ...(pass ? { pass } : {}),
    };
  }

  if (provider === 'memory' && env.NODE_ENV === 'test') {
    return { provider: 'memory' };
  }

  return undefined;
}

export function isMailConfigured(env: EnvMap): boolean {
  return readMailConfig(env) !== undefined;
}
