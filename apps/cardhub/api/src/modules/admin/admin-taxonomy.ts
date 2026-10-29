import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import {
  adminCategoryDeleteInput,
  adminCategoryUpsertInput,
  adminSubsetDeleteInput,
  adminSubsetListInput,
  adminSubsetUpsertInput,
} from '@repo/shared';
import type { TrpcBase } from '../../trpc/trpc-base';
import type { PrismaService } from '../prisma/prisma.service';
import { requireSeriesId } from '../catalog/catalog-links';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrismaUniqueError(error: unknown): boolean {
  return isPlainObject(error) && error.code === 'P2002';
}

function normalizeOptionalText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

const categoryInclude = {
  _count: { select: { series: true } },
} as const;

type CategoryRow = Prisma.CategoryGetPayload<{ include: typeof categoryInclude }>;

function formatCategory(category: CategoryRow) {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    sortOrder: category.sortOrder,
    seriesCount: category._count.series,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

const subsetInclude = {
  _count: { select: { cards: true } },
} as const;

type SubsetRow = Prisma.SubsetGetPayload<{ include: typeof subsetInclude }>;

function formatSubset(subset: SubsetRow) {
  return {
    id: subset.id,
    slug: subset.slug,
    name: subset.name,
    kind: subset.kind,
    sortOrder: subset.sortOrder,
    description: subset.description,
    cardCount: subset._count.cards,
    createdAt: subset.createdAt.toISOString(),
    updatedAt: subset.updatedAt.toISOString(),
  };
}

export function buildAdminTaxonomyRouter(t: TrpcBase, prisma: PrismaService) {
  return {
    categories: t.router({
      list: t.adminProcedure.query(async () => {
        const items = await prisma.category.findMany({
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { slug: 'asc' }],
          include: categoryInclude,
        });
        return { items: items.map(formatCategory) };
      }),

      create: t.adminProcedure.input(adminCategoryUpsertInput).mutation(async ({ input }) => {
        try {
          const category = await prisma.category.create({
            data: {
              slug: input.slug,
              name: input.name,
              description: normalizeOptionalText(input.description),
              sortOrder: input.sortOrder,
            },
            include: categoryInclude,
          });
          return formatCategory(category);
        } catch (error) {
          if (isPrismaUniqueError(error)) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'SLUG_TAKEN',
              cause: { code: 'SLUG_TAKEN' },
            });
          }
          throw error;
        }
      }),

      update: t.adminProcedure.input(adminCategoryUpsertInput).mutation(async ({ input }) => {
        try {
          const category = await prisma.category.update({
            where: { slug: input.slug },
            data: {
              name: input.name,
              description: normalizeOptionalText(input.description),
              sortOrder: input.sortOrder,
            },
            include: categoryInclude,
          });
          return formatCategory(category);
        } catch (error) {
          if (isPlainObject(error) && error.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: '品类不存在' });
          }
          throw error;
        }
      }),

      delete: t.adminProcedure.input(adminCategoryDeleteInput).mutation(async ({ input }) => {
        const category = await prisma.category.findUnique({
          where: { slug: input.slug },
          include: categoryInclude,
        });
        if (!category) throw new TRPCError({ code: 'NOT_FOUND', message: '品类不存在' });
        await prisma.category.delete({ where: { slug: input.slug } });
        return { ok: true as const, slug: input.slug, seriesCount: category._count.series };
      }),
    }),

    subsets: t.router({
      list: t.adminProcedure.input(adminSubsetListInput).query(async ({ input }) => {
        await requireSeriesId(prisma, input.seriesSlug);
        const items = await prisma.subset.findMany({
          where: { series: { slug: input.seriesSlug } },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { slug: 'asc' }],
          include: subsetInclude,
        });
        return { items: items.map(formatSubset) };
      }),

      create: t.adminProcedure.input(adminSubsetUpsertInput).mutation(async ({ input }) => {
        const seriesId = await requireSeriesId(prisma, input.seriesSlug);
        try {
          const subset = await prisma.subset.create({
            data: {
              seriesId,
              slug: input.slug,
              name: input.name,
              description: normalizeOptionalText(input.description),
              kind: input.kind,
              sortOrder: input.sortOrder,
            },
            include: subsetInclude,
          });
          return formatSubset(subset);
        } catch (error) {
          if (isPrismaUniqueError(error)) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'SLUG_TAKEN',
              cause: { code: 'SLUG_TAKEN' },
            });
          }
          throw error;
        }
      }),

      update: t.adminProcedure.input(adminSubsetUpsertInput).mutation(async ({ input }) => {
        const seriesId = await requireSeriesId(prisma, input.seriesSlug);
        try {
          const subset = await prisma.subset.update({
            where: { seriesId_slug: { seriesId, slug: input.slug } },
            data: {
              name: input.name,
              description: normalizeOptionalText(input.description),
              kind: input.kind,
              sortOrder: input.sortOrder,
            },
            include: subsetInclude,
          });
          return formatSubset(subset);
        } catch (error) {
          if (isPlainObject(error) && error.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: '子集不存在' });
          }
          throw error;
        }
      }),

      delete: t.adminProcedure.input(adminSubsetDeleteInput).mutation(async ({ input }) => {
        const seriesId = await requireSeriesId(prisma, input.seriesSlug);
        const subset = await prisma.subset.findUnique({
          where: { seriesId_slug: { seriesId, slug: input.slug } },
          include: subsetInclude,
        });
        if (!subset) throw new TRPCError({ code: 'NOT_FOUND', message: '子集不存在' });
        await prisma.subset.delete({ where: { id: subset.id } });
        return { ok: true as const, slug: input.slug, cardCount: subset._count.cards };
      }),
    }),
  };
}
