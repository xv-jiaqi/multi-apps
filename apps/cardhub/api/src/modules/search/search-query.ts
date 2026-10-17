import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import type { CardSearchParseResult } from '@repo/shared';

function nameGroupWhere(groups: string[][]): Prisma.CardWhereInput[] {
  if (groups.length === 0) return [];
  return [
    {
      OR: groups.map((group) => ({
        AND: group.map((term) => ({ name: { contains: term, mode: 'insensitive' as const } })),
      })),
    },
  ];
}

function seriesTitleGroupWhere(groups: string[][]): Prisma.SeriesWhereInput[] {
  if (groups.length === 0) return [];
  return [
    {
      OR: groups.map((group) => ({
        AND: group.map((term) => ({ title: { contains: term, mode: 'insensitive' as const } })),
      })),
    },
  ];
}

export function assertParsedSearch(
  parsed: CardSearchParseResult,
): Extract<CardSearchParseResult, { ok: true }> {
  if (!parsed.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${parsed.reason}:${parsed.token}`,
    });
  }
  return parsed;
}

export function buildCardSearchWhere(
  parsed: Extract<CardSearchParseResult, { ok: true }>,
): Prisma.CardWhereInput {
  const and: Prisma.CardWhereInput[] = [
    ...(parsed.rarity ? [{ rarity: parsed.rarity }] : []),
    ...(parsed.seriesSlug ? [{ series: { slug: parsed.seriesSlug } }] : []),
    ...nameGroupWhere(parsed.includeGroups),
    ...parsed.excludeTerms.map((term) => ({
      NOT: { name: { contains: term, mode: 'insensitive' as const } },
    })),
  ];

  return and.length > 0 ? { AND: and } : {};
}

export function buildSeriesSearchWhere(
  parsed: Extract<CardSearchParseResult, { ok: true }>,
): Prisma.SeriesWhereInput {
  const and: Prisma.SeriesWhereInput[] = [
    ...(parsed.seriesSlug ? [{ slug: parsed.seriesSlug }] : []),
    ...seriesTitleGroupWhere(parsed.includeGroups),
    ...parsed.excludeTerms.map((term) => ({
      NOT: { title: { contains: term, mode: 'insensitive' as const } },
    })),
  ];

  return and.length > 0 ? { AND: and } : {};
}
