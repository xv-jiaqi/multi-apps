import { z } from 'zod';
import { PUBLIC_WEB_ORIGIN_ERROR, resolvePublicWebOrigin } from '../modules/seo/public-web-origin';

export const BANNED_PRODUCTION_JWT_SECRETS = [
  'dev-insecure-secret',
  'change-me-in-production',
  'change-me-generate-with-openssl-rand-hex-32',
] as const;

const envSchema = z.looseObject({
  NODE_ENV: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  PUBLIC_WEB_ORIGIN: z.string().optional(),
  PASSWORD_PREHASH_WRITE: z.union([z.boolean(), z.string(), z.null()]).optional(),
});

/**
 * Only the exact string "true" enables writes of the pre-hashed format.
 * "TRUE", "1", "yes", empty, and unset all stay off.
 */
const passwordPrehashWriteSchema = z.unknown().transform((value) => value === 'true');

export function passwordPrehashWriteEnabled(source: { PASSWORD_PREHASH_WRITE?: unknown }): boolean {
  return passwordPrehashWriteSchema.parse(source.PASSWORD_PREHASH_WRITE);
}

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

  const normalized = {
    ...config,
    PASSWORD_PREHASH_WRITE: passwordPrehashWriteSchema.parse(config.PASSWORD_PREHASH_WRITE),
  };

  let originError: string | undefined;
  try {
    const corsOrigin = config.CORS_ORIGIN;
    resolvePublicWebOrigin({
      nodeEnv: parsed.data.NODE_ENV,
      publicWebOrigin: parsed.data.PUBLIC_WEB_ORIGIN,
      corsOrigin: typeof corsOrigin === 'string' ? corsOrigin : undefined,
    });
  } catch (error) {
    originError = error instanceof Error ? error.message : PUBLIC_WEB_ORIGIN_ERROR;
  }

  const nodeEnv = envString(parsed.data.NODE_ENV);
  if (nodeEnv !== 'production') {
    if (originError !== undefined) {
      throw new Error(`Invalid Cardhub API environment configuration:\n- ${originError}`);
    }
    return normalized;
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

  if (originError !== undefined) {
    messages.push(originError);
  }

  if (messages.length > 0) {
    throw new Error(`Invalid Cardhub API environment configuration:\n- ${messages.join('\n- ')}`);
  }

  return normalized;
}
