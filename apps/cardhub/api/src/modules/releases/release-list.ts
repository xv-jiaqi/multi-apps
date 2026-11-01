import type { Prisma } from '@prisma/client';

export type ReleaseCursorPoint = {
  releaseDate: Date;
  id: string;
};

export type ReleaseListDirection = 'asc' | 'desc';

export const releaseItemSelect = {
  id: true,
  title: true,
  releaseDate: true,
  datePrecision: true,
  region: true,
  seriesId: true,
  categoryId: true,
  note: true,
  sourceUrl: true,
  createdAt: true,
  updatedAt: true,
  series: { select: { slug: true, title: true, coverUrl: true } },
  category: { select: { slug: true, name: true } },
};

/** Public list walks releaseDate/id ascending. Admin list walks them descending. */
export function releaseOrderBy(
  direction: ReleaseListDirection,
): Prisma.ReleaseOrderByWithRelationInput[] {
  if (direction === 'asc') {
    return [{ releaseDate: 'asc' }, { id: 'asc' }];
  }
  return [{ releaseDate: 'desc' }, { id: 'desc' }];
}

/**
 * Keyset boundary. Ascending lists continue after the point. Descending lists
 * continue before it. The row itself does not need to exist.
 */
export function releaseKeysetWhere(
  point: ReleaseCursorPoint,
  direction: ReleaseListDirection,
): Prisma.ReleaseWhereInput {
  if (direction === 'asc') {
    return {
      OR: [
        { releaseDate: { gt: point.releaseDate } },
        { releaseDate: point.releaseDate, id: { gt: point.id } },
      ],
    };
  }
  return {
    OR: [
      { releaseDate: { lt: point.releaseDate } },
      { releaseDate: point.releaseDate, id: { lt: point.id } },
    ],
  };
}

export function publicReleaseWhere(input: {
  from: Date;
  to: Date;
  categorySlug?: string;
  cursor?: ReleaseCursorPoint;
}): Prisma.ReleaseWhereInput {
  return {
    releaseDate: { gte: input.from, lte: input.to },
    ...(input.categorySlug ? { category: { slug: input.categorySlug } } : {}),
    ...(input.cursor ? releaseKeysetWhere(input.cursor, 'asc') : {}),
  };
}

export function adminReleaseWhere(cursor?: ReleaseCursorPoint): Prisma.ReleaseWhereInput {
  if (!cursor) return {};
  return releaseKeysetWhere(cursor, 'desc');
}
