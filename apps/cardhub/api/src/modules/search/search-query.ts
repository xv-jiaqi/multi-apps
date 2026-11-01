import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import type { CardSearchParseResult } from '@repo/shared';
import { seriesReleaseYearFilter } from './release-year';

type ParsedSearch = Extract<CardSearchParseResult, { ok: true }>;

/**
 * `contains` becomes `ILIKE '%term%'`. `%`, `_`, and `\` are LIKE metacharacters,
 * and the gin_trgm indexes serve that same ILIKE. Escape them so both paths
 * match the typed characters. Series-page `q` stays an in-process literal.
 */
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function insensitiveContains(term: string): {
  contains: string;
  mode: 'insensitive';
} {
  return { contains: escapeLikeTerm(term), mode: 'insensitive' };
}

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
 * A name hit is `true OR NULL` when parallelName is null, so include terms
 * still keep base cards.
 */
function keywordTerm(term: string): Prisma.CardWhereInput {
  return {
    OR: [{ name: insensitiveContains(term) }, { parallelName: insensitiveContains(term) }],
  };
}

/**
 * An excluded term misses both the printed name and the parallel name.
 * `NOT (name OR parallelName)` is NULL when the name misses and parallelName
 * is NULL (`false OR NULL`), and that drops the row. A null parallel name is
 * not a match, so it stays. Series titles are non-null, so their `NOT`
 * does not need the same split. Series-page `q` filters in process and does
 * not negate SQL.
 */
function keywordExclude(term: string): Prisma.CardWhereInput {
  return {
    AND: [
      { NOT: { name: insensitiveContains(term) } },
      {
        OR: [{ parallelName: null }, { NOT: { parallelName: insensitiveContains(term) } }],
      },
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
        AND: group.map((term) => ({ title: insensitiveContains(term) })),
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
    ...parsed.excludeTerms.map((term) => keywordExclude(term)),
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
      NOT: { title: insensitiveContains(term) },
    })),
  ];

  return and.length > 0 ? { AND: and } : {};
}
