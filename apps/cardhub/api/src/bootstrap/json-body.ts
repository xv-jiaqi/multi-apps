import type { NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';
import { CATALOG_IMPORT_MAX_BYTES, t } from '@repo/shared';

/** Nest's Express default. Kept for every route except catalog import. */
export const DEFAULT_JSON_BODY_LIMIT = '100kb';

/**
 * Bytes reserved for the outer tRPC batch envelope around a 1MB procedure
 * input (`{"0": ...}`). The frontend pre-check and the zod / row limits stay
 * at {@link CATALOG_IMPORT_MAX_BYTES} and 500 rows.
 */
export const CATALOG_IMPORT_BATCH_HEADROOM_BYTES = 16 * 1024;

/** HTTP parser cap for `admin.catalog.import` only: 1MB + 16KB. */
export const CATALOG_IMPORT_HTTP_BODY_LIMIT =
  CATALOG_IMPORT_MAX_BYTES + CATALOG_IMPORT_BATCH_HEADROOM_BYTES;

const CATALOG_IMPORT_PROCEDURE = 'admin.catalog.import';

function trpcPaths(req: Request): string[] {
  const pathname = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
  const trpcPath = pathname.replace(/^\/trpc\/?/, '').replace(/^\/+/, '');
  return trpcPath
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);
}

export function isAdminCatalogImportRequest(req: Request): boolean {
  return trpcPaths(req).includes(CATALOG_IMPORT_PROCEDURE);
}

function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: unknown }).type === 'entity.too.large'
  );
}

function catalogImportTooLargeError(path: string | undefined) {
  return {
    error: {
      message: t('zh-CN', 'admin.import.tooLarge'),
      code: -32013,
      data: {
        code: 'PAYLOAD_TOO_LARGE',
        httpStatus: 413,
        ...(path ? { path } : {}),
      },
    },
  };
}

/**
 * JSON (and urlencoded) parser with Nest's 100kb default, except
 * `admin.catalog.import`. That route's HTTP limit is 1MB plus 16KB so a tRPC
 * batch envelope can wrap a procedure input that is still under 1MB. Bodies
 * above that cap are rejected here — before zod and before any catalog write —
 * with the shared Chinese message. Other routes keep the 100kb cap.
 *
 * Nest's built-in parser is a single global limit, so `createApp` disables
 * it (`bodyParser: false`) and mounts this instead.
 */
export function jsonBodyParser(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const importRoute = isAdminCatalogImportRequest(req);
    const limit = importRoute ? CATALOG_IMPORT_HTTP_BODY_LIMIT : DEFAULT_JSON_BODY_LIMIT;
    express.json({ limit })(req, res, (jsonError: unknown) => {
      if (!jsonError) {
        express.urlencoded({ extended: true, limit })(req, res, next);
        return;
      }
      if (importRoute && isPayloadTooLarge(jsonError)) {
        const paths = trpcPaths(req);
        const isBatch = req.query.batch === '1';
        const payload = isBatch
          ? paths.map((path) => catalogImportTooLargeError(path))
          : catalogImportTooLargeError(paths[0]);
        res.status(413).type('application/json').send(payload);
        return;
      }
      next(jsonError as Error);
    });
  };
}
