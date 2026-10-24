import { Injectable } from '@nestjs/common';
import { initTRPC, TRPCError } from '@trpc/server';
import {
  ADMIN_CATALOG_ERROR_CODES,
  APP_ERROR_CODES,
  isAppErrorCode,
  t,
  type AdminCatalogErrorCode,
} from '@repo/shared';
import type { TrpcContext } from './context';

const ADMIN_CATALOG_ERROR_CODE_SET = new Set<string>(ADMIN_CATALOG_ERROR_CODES);
const IMPORT_ROW_STATUS_SET = new Set(['created', 'updated', 'unchanged', 'error']);
const IMPORT_ROW_TYPE_SET = new Set(['series', 'card']);

export interface SanitizedImportRowError {
  path: string;
  code: AdminCatalogErrorCode;
}

export interface SanitizedImportRow {
  row: {
    row: number;
    type: 'series' | 'card';
    slug: string | null;
    name: string | null;
    seriesSlug?: string | null;
  };
  status: 'created' | 'updated' | 'unchanged' | 'error';
  errors: SanitizedImportRowError[];
}

export interface AdminCatalogErrorDetails {
  code?: AdminCatalogErrorCode;
  cardCount?: number;
  commentCount?: number;
  rows?: SanitizedImportRow[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeErrorCode(value: unknown): AdminCatalogErrorCode | undefined {
  return typeof value === 'string' && ADMIN_CATALOG_ERROR_CODE_SET.has(value)
    ? (value as AdminCatalogErrorCode)
    : undefined;
}

function sanitizeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function sanitizeRows(value: unknown): SanitizedImportRow[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const rows: SanitizedImportRow[] = [];
  for (const item of value) {
    if (!isPlainObject(item) || !isPlainObject(item.row)) return undefined;
    const row = item.row;
    const rowNumber = sanitizeNonNegativeInteger(row.row);
    if (rowNumber === undefined) return undefined;
    if (typeof row.type !== 'string' || !IMPORT_ROW_TYPE_SET.has(row.type)) return undefined;
    if (row.slug !== null && typeof row.slug !== 'string') return undefined;
    if (row.name !== null && typeof row.name !== 'string') return undefined;
    if (
      row.seriesSlug !== undefined &&
      row.seriesSlug !== null &&
      typeof row.seriesSlug !== 'string'
    ) {
      return undefined;
    }
    if (typeof item.status !== 'string' || !IMPORT_ROW_STATUS_SET.has(item.status)) {
      return undefined;
    }
    if (!Array.isArray(item.errors)) return undefined;

    const errors: SanitizedImportRowError[] = [];
    for (const error of item.errors) {
      if (!isPlainObject(error) || typeof error.path !== 'string') return undefined;
      const code = sanitizeErrorCode(error.code);
      if (!code) return undefined;
      errors.push({ path: error.path, code });
    }

    rows.push({
      row: {
        row: rowNumber,
        type: row.type as 'series' | 'card',
        slug: row.slug,
        name: row.name,
        ...(row.seriesSlug !== undefined ? { seriesSlug: row.seriesSlug } : {}),
      },
      status: item.status as SanitizedImportRow['status'],
      errors,
    });
  }

  return rows;
}

const INTERNAL_MESSAGE_PATTERN =
  /prisma|invocation|is not valid JSON|Unexpected token|node_modules|syntaxerror|\n\s+at\s+/i;

function hasInternalCause(cause: unknown, depth: number): boolean {
  if (depth > 5 || typeof cause !== 'object' || cause === null) return false;
  if (cause instanceof Error) {
    if (
      cause.name.startsWith('Prisma') ||
      cause.name === 'SyntaxError' ||
      cause.name === 'URIError'
    ) {
      return true;
    }
  }
  if ('cause' in cause) return hasInternalCause(cause.cause, depth + 1);
  return false;
}

function publicErrorMessage(
  message: string,
  code: string,
  httpStatus: number | undefined,
  cause: unknown,
): string {
  if (process.env.NODE_ENV !== 'production') return message;
  const serverFailure =
    code === 'INTERNAL_SERVER_ERROR' || (typeof httpStatus === 'number' && httpStatus >= 500);
  if (serverFailure || hasInternalCause(cause, 0) || INTERNAL_MESSAGE_PATTERN.test(message)) {
    return t('zh-CN', 'error.internal');
  }
  return message;
}

function readAppCode(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('appCode' in cause)) return undefined;
  return isAppErrorCode(cause.appCode) ? cause.appCode : undefined;
}

function isZodCause(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const named = cause as { name?: unknown; issues?: unknown };
  return named.name === 'ZodError' || Array.isArray(named.issues);
}

function resolvedAppCode(error: { code: string; cause?: unknown }): string {
  const fromCause = readAppCode(error.cause);
  if (fromCause) return fromCause;
  if (isZodCause(error.cause)) return APP_ERROR_CODES.VALIDATION;
  if (isAppErrorCode(error.code)) return error.code;
  return APP_ERROR_CODES.UNKNOWN;
}

function sanitizeAdminCatalogError(cause: unknown): AdminCatalogErrorDetails | undefined {
  if (!isPlainObject(cause)) return undefined;

  const details: AdminCatalogErrorDetails = {};
  const code = sanitizeErrorCode(cause.code);
  if (code) details.code = code;

  const cardCount = sanitizeNonNegativeInteger(cause.cardCount);
  if (cardCount !== undefined) details.cardCount = cardCount;

  const commentCount = sanitizeNonNegativeInteger(cause.commentCount);
  if (commentCount !== undefined) details.commentCount = commentCount;

  const rows = sanitizeRows(cause.rows);
  if (rows) details.rows = rows;

  return Object.keys(details).length > 0 ? details : undefined;
}

/** Bearer token missing, revoked, or no longer matching tokenVersion. */
function sessionRejected(): TRPCError {
  return new TRPCError({
    code: 'UNAUTHORIZED',
    cause: { appCode: APP_ERROR_CODES.UNAUTHORIZED },
  });
}

const trpc = initTRPC.context<TrpcContext>().create({
  errorFormatter({ shape, error }) {
    const adminCatalogError = sanitizeAdminCatalogError(error.cause);
    const appCode = resolvedAppCode(error);
    const data = {
      ...shape.data,
      ...(adminCatalogError ? { adminCatalogError } : {}),
      appCode,
    };
    if (process.env.NODE_ENV === 'production') {
      delete data.stack;
    }
    return {
      ...shape,
      message: publicErrorMessage(shape.message, error.code, shape.data.httpStatus, error.cause),
      data,
    };
  },
});

type TrpcRouterBuilder = typeof trpc.router;
type TrpcMergeRouters = typeof trpc.mergeRouters;
type TrpcMiddleware = typeof trpc.middleware;
type TrpcProcedure = typeof trpc.procedure;

/**
 * TrpcBase wraps a shared tRPC builder instance so that feature modules can
 * declare their own routers via NestJS DI while reusing the same `t` factory.
 */
@Injectable()
export class TrpcBase {
  readonly router: TrpcRouterBuilder = trpc.router;
  readonly mergeRouters: TrpcMergeRouters = trpc.mergeRouters;
  readonly middleware: TrpcMiddleware = trpc.middleware;
  readonly procedure: TrpcProcedure = trpc.procedure;

  readonly authedProcedure: TrpcProcedure = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.user) {
      throw sessionRejected();
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  }) as unknown as TrpcProcedure;

  readonly adminProcedure: TrpcProcedure = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.user) {
      throw sessionRejected();
    }
    if (ctx.user.role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: '仅管理员可管理内容' });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        adminUser: { id: ctx.user.sub, role: ctx.user.role },
      },
    });
  }) as unknown as TrpcProcedure;
}
