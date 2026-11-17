import { z } from 'zod';

const TRPC_URL_PATTERN = /^https?:\/\/[^\s"\\;']+\/trpc$/;
const SENTRY_DSN_PATTERN = /^https?:\/\/[^\s"\\]+$/;

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function withoutBreakout(field: string) {
  return z.string().superRefine((value, context) => {
    if (hasControlCharacter(value) || /[\s"\\]/.test(value)) {
      context.addIssue({
        code: 'custom',
        message: `${field} must not contain whitespace, quotes, backslashes, or control characters`,
      });
    }
  });
}

export const runtimeConfigSchema = z.strictObject({
  TRPC_URL: z.string().superRefine((value, context) => {
    if (hasControlCharacter(value)) {
      context.addIssue({
        code: 'custom',
        message: 'TRPC_URL must not contain control characters',
      });
      return;
    }
    if (!TRPC_URL_PATTERN.test(value)) {
      context.addIssue({
        code: 'custom',
        message:
          'TRPC_URL must be a full http(s) URL ending in /trpc without whitespace, quotes, backslashes, or semicolons',
      });
    }
  }),
  SENTRY_DSN: z
    .string()
    .superRefine((value, context) => {
      if (hasControlCharacter(value) || /[\s"\\]/.test(value) || !SENTRY_DSN_PATTERN.test(value)) {
        context.addIssue({
          code: 'custom',
          message:
            'SENTRY_DSN must be a full http(s) URL without whitespace, quotes, or backslashes',
        });
      }
    })
    .optional(),
  SENTRY_ENVIRONMENT: withoutBreakout('SENTRY_ENVIRONMENT').optional(),
  GIT_SHA: withoutBreakout('GIT_SHA').optional(),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

const ASSIGNMENT = /^window\.__CARDHUB_CONFIG__ = \{\n([\s\S]*?)\n\};\n?$/;
const PAIR = /^ {2}([A-Z_]+): "(.*)"(?:,)?$/;

export function parseRuntimeConfigScript(source: string): unknown {
  const match = ASSIGNMENT.exec(source);
  if (!match) {
    throw new Error(
      'config.js is invalid: expected window.__CARDHUB_CONFIG__ = { ... }; with quoted string fields',
    );
  }
  const body = match[1];
  if (body === undefined) {
    throw new Error('config.js is invalid: expected window.__CARDHUB_CONFIG__ = { ... };');
  }
  if (body.trim() === '') {
    return {};
  }
  const record: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const pair = PAIR.exec(line);
    if (!pair || pair[1] === undefined || pair[2] === undefined) {
      throw new Error(`config.js is invalid: unexpected line ${line}`);
    }
    record[pair[1]] = pair[2].replace(/\\(.)/g, '$1');
  }
  return record;
}

function fieldName(issue: { path: PropertyKey[]; code: string }): string {
  const first = issue.path[0];
  return typeof first === 'string' ? first : 'config.js';
}

export function formatRuntimeConfigError(error: z.ZodError): string {
  const parts = error.issues.map((issue) => {
    const name = fieldName(issue);
    if (issue.code === 'invalid_type' && !('input' in issue && issue.input !== undefined)) {
      return `missing required field ${name}`;
    }
    if (issue.code === 'unrecognized_keys') {
      const keys = 'keys' in issue && Array.isArray(issue.keys) ? issue.keys.join(', ') : name;
      return `unexpected field ${keys}`;
    }
    return `field ${name} has an invalid format`;
  });
  return `config.js is invalid: ${parts.join('; ')}`;
}

export function assertRuntimeConfig(value: unknown): RuntimeConfig {
  const parsed = runtimeConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(formatRuntimeConfigError(parsed.error));
  }
  return parsed.data;
}

export function assertRuntimeConfigScript(source: string): RuntimeConfig {
  return assertRuntimeConfig(parseRuntimeConfigScript(source));
}
