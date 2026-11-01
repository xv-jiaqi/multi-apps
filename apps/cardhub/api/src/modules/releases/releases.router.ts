import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import {
  APP_ERROR_CODES,
  RELEASE_LIST_LIMIT_DEFAULT,
  adminReleasesListInput,
  parseShanghaiCivilDate,
  releaseCreateInput,
  releaseDeleteInput,
  releaseUpdateInput,
  releasesListInput,
  storedReleaseDate,
  type ReleaseCreateInput,
  type ReleaseDatePrecisionValue,
  type ReleaseRegionValue,
} from '@repo/shared';
import type { ZodType } from 'zod';
import { normalizeDeleteReason, writeContentDelete } from '../audit/content-delete';
import { formatReleaseDate } from '../catalog/release-date';
import { PrismaService } from '../prisma/prisma.service';
import { TrpcBase } from '../../trpc/trpc-base';
import { decodeReleaseCursor, encodeReleaseCursor } from './release-cursor';
import {
  adminReleaseWhere,
  publicReleaseWhere,
  releaseItemSelect,
  releaseOrderBy,
  type ReleaseCursorPoint,
} from './release-list';

type ReleaseSeriesRef = {
  slug: string;
  title: string;
  coverUrl: string | null;
};

type ReleaseCategoryRef = {
  slug: string;
  name: string;
};

type ReleaseRow = {
  id: string;
  title: string;
  releaseDate: Date;
  datePrecision: ReleaseDatePrecisionValue;
  region: ReleaseRegionValue | null;
  seriesId: string | null;
  categoryId: string | null;
  note: string | null;
  sourceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  series: ReleaseSeriesRef | null;
  category: ReleaseCategoryRef | null;
};

function badRequest(message: string): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message,
    cause: { appCode: APP_ERROR_CODES.VALIDATION },
  });
}

function notFound(message: string): TRPCError {
  return new TRPCError({
    code: 'NOT_FOUND',
    message,
    cause: { appCode: APP_ERROR_CODES.NOT_FOUND },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectBadCursor<T extends ZodType>(schema: T) {
  return schema.superRefine((value, ctx) => {
    if (!isRecord(value) || !('cursor' in value) || value.cursor === undefined) return;
    if (typeof value.cursor !== 'string' || decodeReleaseCursor(value.cursor) === null) {
      ctx.addIssue({ code: 'custom', path: ['cursor'], message: 'invalid_format' });
    }
  });
}

const publicListInput = rejectBadCursor(releasesListInput);
const adminListInput = rejectBadCursor(adminReleasesListInput).optional();

function formatStoredReleaseDate(value: Date): string {
  const formatted = formatReleaseDate(value);
  if (formatted) return formatted;
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '发售日期无法表示' });
}

function formatRelease(row: ReleaseRow) {
  return {
    id: row.id,
    title: row.title,
    releaseDate: formatStoredReleaseDate(row.releaseDate),
    datePrecision: row.datePrecision,
    region: row.region,
    seriesId: row.seriesId,
    categoryId: row.categoryId,
    note: row.note,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    series: row.series
      ? { slug: row.series.slug, title: row.series.title, coverUrl: row.series.coverUrl }
      : null,
    category: row.category ? { slug: row.category.slug, name: row.category.name } : null,
  };
}

function cursorPoint(cursor: string | undefined): ReleaseCursorPoint | undefined {
  if (cursor === undefined) return undefined;
  const decoded = decodeReleaseCursor(cursor);
  if (!decoded) throw badRequest('invalid_format');
  const releaseDate = parseShanghaiCivilDate(decoded.releaseDate);
  if (!releaseDate) throw badRequest('invalid_format');
  return { releaseDate, id: decoded.id };
}

function writeData(input: ReleaseCreateInput) {
  const releaseDate = storedReleaseDate(input.releaseDate, input.datePrecision);
  if (!releaseDate) throw badRequest('invalid_date');
  return {
    title: input.title,
    releaseDate,
    datePrecision: input.datePrecision,
    region: input.region ?? null,
    seriesId: input.seriesId ?? null,
    categoryId: input.categoryId ?? null,
    note: input.note ?? null,
    sourceUrl: input.sourceUrl ?? null,
  };
}

function pageReleases(rows: ReleaseRow[], limit: number | undefined) {
  if (limit === undefined) {
    return { items: rows.map(formatRelease), nextCursor: null };
  }
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(formatRelease),
    nextCursor:
      hasMore && last
        ? encodeReleaseCursor(formatStoredReleaseDate(last.releaseDate), last.id)
        : null,
  };
}

@Injectable()
export class ReleasesRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      list: t.procedure.input(publicListInput).query(async ({ input }) => {
        const from = parseShanghaiCivilDate(input.from);
        const to = parseShanghaiCivilDate(input.to);
        if (!from || !to) throw badRequest('invalid_date');
        const limit = input.limit;
        const rows = await prisma.release.findMany({
          where: publicReleaseWhere({
            from,
            to,
            ...(input.categorySlug ? { categorySlug: input.categorySlug } : {}),
            ...(input.cursor ? { cursor: cursorPoint(input.cursor) } : {}),
          }),
          orderBy: releaseOrderBy('asc'),
          select: releaseItemSelect,
          take: limit + 1,
        });
        return pageReleases(rows, limit);
      }),
    });
  }

  buildAdmin() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      list: t.adminProcedure.input(adminListInput).query(async ({ input }) => {
        const limit = input?.limit ?? RELEASE_LIST_LIMIT_DEFAULT;
        const point = cursorPoint(input?.cursor);
        const rows = await prisma.release.findMany({
          where: adminReleaseWhere(point),
          orderBy: releaseOrderBy('desc'),
          select: releaseItemSelect,
          take: limit + 1,
        });
        return pageReleases(rows, limit);
      }),

      create: t.adminProcedure.input(releaseCreateInput).mutation(async ({ input }) => {
        const data = writeData(input);
        await this.requireLinks(data.seriesId ?? null, data.categoryId ?? null);
        const row = await prisma.release.create({ data, select: releaseItemSelect });
        return formatRelease(row);
      }),

      update: t.adminProcedure.input(releaseUpdateInput).mutation(async ({ input }) => {
        const data = writeData(input);
        await this.requireLinks(data.seriesId ?? null, data.categoryId ?? null);
        try {
          const row = await prisma.release.update({
            where: { id: input.id },
            data,
            select: releaseItemSelect,
          });
          return formatRelease(row);
        } catch (error) {
          if (prismaCode(error) === 'P2025') throw notFound('发售条目不存在');
          throw error;
        }
      }),

      delete: t.adminProcedure.input(releaseDeleteInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const actor = ctx.user;
        const existing = await prisma.release.findUnique({
          where: { id: input.id },
          select: { id: true, title: true },
        });
        if (!existing) throw notFound('发售条目不存在');
        await prisma.$transaction(async (tx) => {
          await tx.release.delete({ where: { id: existing.id } });
          await writeContentDelete(tx, {
            actorId: actor.sub,
            actorUsername: actor.username,
            targetType: 'RELEASE',
            targetId: existing.id,
            targetLabel: existing.title,
            targetUserId: null,
            reason: normalizeDeleteReason(input.reason),
          });
        });
        return { id: existing.id };
      }),
    });
  }

  private async requireLinks(seriesId: string | null, categoryId: string | null): Promise<void> {
    const [series, category] = await Promise.all([
      seriesId
        ? this.prisma.series.findUnique({ where: { id: seriesId }, select: { id: true } })
        : Promise.resolve(null),
      categoryId
        ? this.prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } })
        : Promise.resolve(null),
    ]);
    if (seriesId && !series) throw notFound('系列不存在');
    if (categoryId && !category) throw notFound('品类不存在');
  }
}

function prismaCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}
