import type { NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';
import { APP_ERROR_CODES, CATALOG_IMPORT_MAX_BYTES, t } from '@repo/shared';

/**
 * Nest's 100kb default for every route except catalog import.
 * The largest bounded procedure (forum topic update, 10k-char body) fits
 * inside a tRPC batch envelope with headroom. Catalog import is the only
 * route above this cap.
 */
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

export type ParserClientStatus = 400 | 403 | 413 | 415;

/**
 * body-parser / raw-body `type` values that are client mistakes. The status
 * comes from this map, not from whatever `status` the error object carries.
 */
const PARSER_CLIENT_ERRORS: Record<string, ParserClientStatus> = {
  'entity.too.large': 413,
  'parameters.too.many': 413,
  'entity.parse.failed': 400,
  'request.aborted': 400,
  'request.size.invalid': 400,
  'querystring.parse.rangeError': 400,
  'entity.verify.failed': 403,
  'charset.unsupported': 415,
  'encoding.unsupported': 415,
};

const TRPC_ERROR_BY_STATUS: Record<ParserClientStatus, { code: number; name: string }> = {
  400: { code: -32600, name: 'BAD_REQUEST' },
  403: { code: -32003, name: 'FORBIDDEN' },
  413: { code: -32013, name: 'PAYLOAD_TOO_LARGE' },
  415: { code: -32015, name: 'UNSUPPORTED_MEDIA_TYPE' },
};

type ParserRequest = {
  originalUrl?: string;
  url?: string;
  query?: { batch?: unknown };
};

function requestPathname(req: ParserRequest): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
}

export function isTrpcRequest(req: ParserRequest | undefined): boolean {
  if (!req) return false;
  const pathname = requestPathname(req);
  return pathname === '/trpc' || pathname.startsWith('/trpc/');
}

function trpcPaths(req: ParserRequest): string[] {
  const trpcPath = requestPathname(req)
    .replace(/^\/trpc\/?/, '')
    .replace(/^\/+/, '');
  return trpcPath
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);
}

export function isAdminCatalogImportRequest(req: Request): boolean {
  return trpcPaths(req).includes(CATALOG_IMPORT_PROCEDURE);
}

export type ParserReason = 'parse' | 'request';

export type ParserFailure = {
  status: ParserClientStatus;
  reason: ParserReason;
};

const JSON_PARSE_TYPES = new Set(['entity.parse.failed']);

function errorType(error: object): string | undefined {
  if (!('type' in error)) return undefined;
  const type = error.type;
  return typeof type === 'string' ? type : undefined;
}

export function parserClientStatus(error: unknown): ParserClientStatus | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const type = errorType(error);
  if (type === undefined) return undefined;
  return PARSER_CLIENT_ERRORS[type];
}

export function parserClientFailure(error: unknown): ParserFailure | undefined {
  const status = parserClientStatus(error);
  if (status !== undefined && typeof error === 'object' && error !== null) {
    const type = errorType(error);
    const reason: ParserReason =
      status === 400 && type !== undefined && JSON_PARSE_TYPES.has(type) ? 'parse' : 'request';
    return { status, reason };
  }
  if (error instanceof SyntaxError || error instanceof URIError) {
    return { status: 400, reason: 'parse' };
  }
  return undefined;
}

function messageFor(failure: ParserFailure, path: string | undefined): string {
  if (failure.status === 413) {
    const key =
      path === CATALOG_IMPORT_PROCEDURE ? 'admin.import.tooLarge' : 'error.app.PAYLOAD_TOO_LARGE';
    return t('zh-CN', key);
  }
  if (failure.status === 415) return t('zh-CN', 'error.unsupportedMedia');
  if (failure.status === 403) return t('zh-CN', 'error.requestRejected');
  if (failure.reason === 'parse') return t('zh-CN', 'error.app.PARSE_ERROR');
  return t('zh-CN', 'error.app.BAD_REQUEST');
}

function appCodeFor(failure: ParserFailure): string | undefined {
  if (failure.status === 413) return APP_ERROR_CODES.PAYLOAD_TOO_LARGE;
  if (failure.status !== 400) return undefined;
  return failure.reason === 'parse' ? APP_ERROR_CODES.PARSE_ERROR : APP_ERROR_CODES.BAD_REQUEST;
}

function trpcClientError(path: string | undefined, failure: ParserFailure) {
  const coded = TRPC_ERROR_BY_STATUS[failure.status];
  const appCode = appCodeFor(failure);
  return {
    error: {
      message: messageFor(failure, path),
      code: coded.code,
      data: {
        code: coded.name,
        httpStatus: failure.status,
        ...(appCode ? { appCode } : {}),
        ...(path ? { path } : {}),
      },
    },
  };
}

/**
 * Body for a known parser failure. `/trpc` uses the same tRPC error envelope
 * as an oversized body. Every other route gets a fixed JSON object. Neither
 * shape includes the parser's own message or the request body.
 */
export function clientParserHttpBody(
  req: ParserRequest | undefined,
  failure: ParserFailure,
): unknown {
  if (!isTrpcRequest(req) || !req) {
    return { statusCode: failure.status, message: messageFor(failure, undefined) };
  }
  const paths = trpcPaths(req);
  const isBatch = req.query?.batch === '1';
  return isBatch
    ? paths.map((path) => trpcClientError(path, failure))
    : trpcClientError(paths[0], failure);
}

function errorToForward(error: unknown): Error {
  return error instanceof Error ? error : new Error('parser failure');
}

function rejectClientParserError(req: Request, res: Response, failure: ParserFailure): void {
  res.status(failure.status).type('application/json').send(clientParserHttpBody(req, failure));
}

/**
 * JSON (and urlencoded) parser with Nest's 100kb default, except
 * `admin.catalog.import`. That route's HTTP limit is 1MB plus 16KB so a tRPC
 * batch envelope can wrap a procedure input that is still under 1MB.
 *
 * Oversized bodies and parser failures are answered here, before the handler
 * and before Nest can wrap a `SyntaxError` into a `BadRequestException`.
 * Catalog import keeps the import-specific 413 message. Bad JSON uses
 * PARSE_ERROR. Other client 400s use BAD_REQUEST. Unknown parser failures
 * are still forwarded.
 *
 * Nest's built-in parser is a single global limit, so `createApp` disables
 * it (`bodyParser: false`) and mounts this instead.
 */
export function jsonBodyParser(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const importRoute = isAdminCatalogImportRequest(req);
    const limit = importRoute ? CATALOG_IMPORT_HTTP_BODY_LIMIT : DEFAULT_JSON_BODY_LIMIT;
    express.json({ limit })(req, res, (jsonError: unknown) => {
      if (jsonError) {
        const failure = parserClientFailure(jsonError);
        if (failure) {
          rejectClientParserError(req, res, failure);
          return;
        }
        next(errorToForward(jsonError));
        return;
      }
      express.urlencoded({ extended: true, limit })(req, res, (urlError: unknown) => {
        if (!urlError) {
          next();
          return;
        }
        const failure = parserClientFailure(urlError);
        if (failure) {
          rejectClientParserError(req, res, failure);
          return;
        }
        next(errorToForward(urlError));
      });
    });
  };
}
