import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import type { CardSearchParseResult } from '@repo/shared';
import { seriesReleaseYearFilter } from './release-year';

type ParsedSearch = Extract<CardSearchParseResult, { ok: true }>;

function seriesPrefixFilter(parsed: ParsedSearch): Prisma.SeriesWhereInput | undefined {
  const where: Prisma.SeriesWhereInput = {};
  if (parsed.seriesSlug) where.slug = parsed.seriesSlug;
  if (parsed.releaseYear !== undefined) {
    where.releaseDate = seriesReleaseYearFilter(parsed.releaseYear);
  }
  return Object.keys(where).length > 0 ? where : undefined;
}

/**
 * A free-text term matches the printed name or the parallel name. Card number
 * stays on the `c:` prefix. Series-page `q` does not use this helper.
 */
function keywordTerm(term: string): Prisma.CardWhereInput {
  return {
    OR: [
      { name: { contains: term, mode: 'insensitive' } },
      { parallelName: { contains: term, mode: 'insensitive' } },
    ],
  };
}

function nameGroupWhere(groups: string[][]): Prisma.CardWhereInput[] {
  if (groups.length === 0) return [];
  return [
    {
      OR: groups.map((group) => ({
        AND: group.map((term) => keywordTerm(term)),
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

export function buildCardSearchWhere(parsed: ParsedSearch): Prisma.CardWhereInput {
  const series = seriesPrefixFilter(parsed);
  const and: Prisma.CardWhereInput[] = [
    ...(parsed.rarity ? [{ rarity: parsed.rarity }] : []),
    ...(parsed.cardNumber ? [{ cardNumberNormalized: parsed.cardNumber }] : []),
    ...(series ? [{ series }] : []),
    ...nameGroupWhere(parsed.includeGroups),
    ...parsed.excludeTerms.map((term) => ({
      NOT: keywordTerm(term),
    })),
  ];

  return and.length > 0 ? { AND: and } : {};
}

export function buildSeriesSearchWhere(parsed: ParsedSearch): Prisma.SeriesWhereInput {
  const and: Prisma.SeriesWhereInput[] = [
    ...(parsed.seriesSlug ? [{ slug: parsed.seriesSlug }] : []),
    ...(parsed.releaseYear !== undefined
      ? [{ releaseDate: seriesReleaseYearFilter(parsed.releaseYear) }]
      : []),
    ...seriesTitleGroupWhere(parsed.includeGroups),
    ...parsed.excludeTerms.map((term) => ({
      NOT: { title: { contains: term, mode: 'insensitive' as const } },
    })),
  ];

  return and.length > 0 ? { AND: and } : {};
}
