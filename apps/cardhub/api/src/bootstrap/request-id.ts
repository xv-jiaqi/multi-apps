import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** Canonical response header. Incoming headers are read lower-case. */
export const REQUEST_ID_HEADER_NAME = 'X-Request-Id';

export const REQUEST_ID_MAX_LENGTH = 128;

/**
 * Safe to copy into a response header and a JSON log line.
 * The first character is alphanumeric so a value cannot look like a flag or a
 * leading dot. CR, LF, spaces, quotes, and commas are rejected so a caller
 * cannot break the log line or inject another header.
 */
export const requestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(REQUEST_ID_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export function resolveRequestId(header: string | readonly string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  const parsed = requestIdSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return randomUUID();
}

export function requestIdFrom(req: { id?: unknown } | undefined): string | undefined {
  if (!req) return undefined;
  const parsed = requestIdSchema.safeParse(req.id);
  return parsed.success ? parsed.data : undefined;
}
