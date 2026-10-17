import { Injectable, Optional } from '@nestjs/common';
import { initTRPC, TRPCError } from '@trpc/server';
import { ADMIN_CATALOG_ERROR_CODES, type AdminCatalogErrorCode } from '@repo/shared';
import type { TrpcContext } from './context';
import { PrismaService } from '../modules/prisma/prisma.service';

const ADMIN_CATALOG_ERROR_CODE_SET = new Set<string>(ADMIN_CATALOG_ERROR_CODES);
const IMPORT_ROW_STATUS_SET = new Set(['created', 'updated', 'unchanged', 'error']);
const IMPORT_ROW_TYPE_SET = new Set(['series', 'card']);

interface SanitizedImportRowError {
  path: string;
  code: AdminCatalogErrorCode;
}

interface SanitizedImportRow {
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

interface AdminCatalogErrorDetails {
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

const t = initTRPC.context<TrpcContext>().create({
  errorFormatter({ shape, error }) {
    const adminCatalogError = sanitizeAdminCatalogError(error.cause);
    return {
      ...shape,
      data: {
        ...shape.data,
        ...(adminCatalogError ? { adminCatalogError } : {}),
      },
    };
  },
});

type TrpcRouterBuilder = typeof t.router;
type TrpcMergeRouters = typeof t.mergeRouters;
type TrpcMiddleware = typeof t.middleware;
type TrpcProcedure = typeof t.procedure;

/**
 * TrpcBase wraps a shared tRPC builder instance so that feature modules can
 * declare their own routers via NestJS DI while reusing the same `t` factory.
 */
@Injectable()
export class TrpcBase {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  readonly router: TrpcRouterBuilder = t.router;
  readonly mergeRouters: TrpcMergeRouters = t.mergeRouters;
  readonly middleware: TrpcMiddleware = t.middleware;
  readonly procedure: TrpcProcedure = t.procedure;

  readonly authedProcedure: TrpcProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  }) as unknown as TrpcProcedure;

  readonly adminProcedure: TrpcProcedure = t.procedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    if (!this.prisma) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Prisma 未初始化' });
    }
    const requester = await this.prisma.user.findUnique({
      where: { id: ctx.user.sub },
      select: { id: true, role: true },
    });
    if (requester?.role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: '仅管理员可管理内容' });
    }
    return next({ ctx: { ...ctx, user: ctx.user, adminUser: requester } });
  }) as unknown as TrpcProcedure;
}
