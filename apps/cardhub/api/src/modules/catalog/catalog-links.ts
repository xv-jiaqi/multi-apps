import { TRPCError } from '@trpc/server';
import type { PrismaService } from '../prisma/prisma.service';

function notFound(
  message: string,
  code: 'CATEGORY_NOT_FOUND' | 'SUBSET_NOT_FOUND' | 'SERIES_NOT_FOUND',
) {
  return new TRPCError({ code: 'NOT_FOUND', message, cause: { code } });
}

/**
 * Undefined means the caller did not send the field. Empty string clears it.
 * A slug that does not exist is NOT_FOUND, not a silent clear.
 */
export async function categoryIdForSlug(
  prisma: PrismaService,
  categorySlug: string | undefined,
): Promise<string | null | undefined> {
  if (categorySlug === undefined) return undefined;
  if (categorySlug === '') return null;
  const category = await prisma.category.findUnique({
    where: { slug: categorySlug },
    select: { id: true },
  });
  if (!category) throw notFound('品类不存在', 'CATEGORY_NOT_FOUND');
  return category.id;
}

/** The subset must belong to the card's series. */
export async function subsetIdForSlug(
  prisma: PrismaService,
  seriesId: string,
  subsetSlug: string | undefined,
): Promise<string | null | undefined> {
  if (subsetSlug === undefined) return undefined;
  if (subsetSlug === '') return null;
  const subset = await prisma.subset.findUnique({
    where: { seriesId_slug: { seriesId, slug: subsetSlug } },
    select: { id: true },
  });
  if (!subset) throw notFound('子集不存在', 'SUBSET_NOT_FOUND');
  return subset.id;
}

export async function requireSeriesId(prisma: PrismaService, seriesSlug: string): Promise<string> {
  const series = await prisma.series.findUnique({
    where: { slug: seriesSlug },
    select: { id: true },
  });
  if (!series) throw notFound('系列不存在', 'SERIES_NOT_FOUND');
  return series.id;
}
