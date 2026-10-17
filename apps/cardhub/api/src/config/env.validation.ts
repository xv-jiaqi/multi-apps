import { z } from 'zod';

export const BANNED_PRODUCTION_JWT_SECRETS = [
  'dev-insecure-secret',
  'change-me-in-production',
  'change-me-generate-with-openssl-rand-hex-32',
] as const;

const envSchema = z.looseObject({
  NODE_ENV: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

function envString(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const messages = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid Cardhub API environment configuration:\n- ${messages.join('\n- ')}`);
  }

  const nodeEnv = envString(parsed.data.NODE_ENV);
  if (nodeEnv !== 'production') {
    return config;
  }

  const messages: string[] = [];
  const jwtSecret = envString(parsed.data.JWT_SECRET);
  const databaseUrl = envString(parsed.data.DATABASE_URL);

  if (!jwtSecret) {
    messages.push('JWT_SECRET is required when NODE_ENV=production');
  } else {
    if (jwtSecret.length < 32) {
      messages.push('JWT_SECRET must be at least 32 characters when NODE_ENV=production');
    }

    if (
      BANNED_PRODUCTION_JWT_SECRETS.includes(
        jwtSecret as (typeof BANNED_PRODUCTION_JWT_SECRETS)[number],
      )
    ) {
      messages.push(`JWT_SECRET must not use the placeholder value "${jwtSecret}"`);
    }
  }

  if (!databaseUrl) {
    messages.push('DATABASE_URL is required when NODE_ENV=production');
  }

  if (messages.length > 0) {
    throw new Error(`Invalid Cardhub API environment configuration:\n- ${messages.join('\n- ')}`);
  }

  return config;
}
