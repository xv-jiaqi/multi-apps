import { z } from 'zod';
import { appErrorMessage, type Locale } from '@repo/shared';

/**
 * The only parts of a tRPC client error the miniapp reads. The server message
 * is deliberately not part of the schema: CH-301 §6 forbids showing
 * `e.message`, status codes, or zod text to the user.
 */
const trpcErrorDataSchema = z.object({
  data: z
    .object({
      code: z.string().optional(),
      appCode: z.string().optional(),
    })
    .nullish(),
});

export type TrpcErrorCodes = { code: string | undefined; appCode: string | undefined };

export function readTrpcErrorCodes(error: unknown): TrpcErrorCodes {
  const parsed = trpcErrorDataSchema.safeParse(error);
  if (!parsed.success || !parsed.data.data) return { code: undefined, appCode: undefined };
  return { code: parsed.data.data.code, appCode: parsed.data.data.appCode };
}

/** Block-level read failure. `notFound` keeps `state.notFound`; the rest use the red box. */
export type LoadFailureKind = 'notFound' | 'failed';
export type LoadFailure = { kind: LoadFailureKind };

export function classifyLoadError(error: unknown): LoadFailure {
  const { code, appCode } = readTrpcErrorCodes(error);
  if (code === 'NOT_FOUND' || appCode === 'NOT_FOUND') return { kind: 'notFound' };
  return { kind: 'failed' };
}

/**
 * Fixed copy for a failed write. Page copy for a known app code wins,
 * otherwise the shared `error.app.*` sentence. Never the server text.
 */
export function mutationErrorMessage(args: {
  locale: Locale;
  error: unknown;
  copy?: Readonly<Partial<Record<string, string>>>;
}): string {
  const { appCode } = readTrpcErrorCodes(args.error);
  const pageCopy = appCode ? args.copy?.[appCode] : undefined;
  if (pageCopy) return pageCopy;
  return appErrorMessage(args.locale, appCode);
}

/** A local NOT_FOUND (e.g. a page opened without its `slug` param). */
export class LocalNotFoundError extends Error {
  readonly data = { code: 'NOT_FOUND' } as const;
}
