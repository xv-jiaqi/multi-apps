import { shanghaiCivilDate } from '@repo/shared';
import type { PrismaService } from '../prisma/prisma.service';

export type SeriesRelease = {
  id: string;
  title: string;
  releaseDate: string;
  datePrecision: 'DAY' | 'MONTH';
  region: 'CN' | 'JP' | 'GLOBAL' | null;
  sourceUrl: string | null;
};

/** Five shown plus one so the page knows there are more. */
export const SERIES_RELEASES_LIMIT = 6;

/**
 * CH-206 §8 / §11-4. Upcoming entries (today or later in Asia/Shanghai;
 * a MONTH entry counts while its month is current) by date ascending, then
 * past entries newest first, up to six in total. Ties break on id.
 *
 * Read on every request rather than inside the series cache, because
 * release edits do not invalidate the series key.
 */
export async function loadSeriesReleases(
  prisma: PrismaService,
  seriesId: string,
  now: Date = new Date(),
): Promise<SeriesRelease[]> {
  const today = shanghaiCivilDate(now);
  const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const select = {
    id: true,
    title: true,
    releaseDate: true,
    datePrecision: true,
    region: true,
    sourceUrl: true,
  } as const;
  const upcomingWhere = {
    seriesId,
    OR: [
      { datePrecision: 'DAY' as const, releaseDate: { gte: todayDate } },
      { datePrecision: 'MONTH' as const, releaseDate: { gte: monthStart } },
    ],
  };
  const upcoming = await prisma.release.findMany({
    where: upcomingWhere,
    orderBy: [{ releaseDate: 'asc' }, { id: 'asc' }],
    take: SERIES_RELEASES_LIMIT,
    select,
  });
  const past =
    upcoming.length < SERIES_RELEASES_LIMIT
      ? await prisma.release.findMany({
          where: { seriesId, NOT: { OR: upcomingWhere.OR } },
          orderBy: [{ releaseDate: 'desc' }, { id: 'desc' }],
          take: SERIES_RELEASES_LIMIT - upcoming.length,
          select,
        })
      : [];
  return [...upcoming, ...past].map((row) => ({
    id: row.id,
    title: row.title,
    releaseDate: row.releaseDate.toISOString().slice(0, 10),
    datePrecision: row.datePrecision,
    region: row.region,
    sourceUrl: row.sourceUrl,
  }));
}
