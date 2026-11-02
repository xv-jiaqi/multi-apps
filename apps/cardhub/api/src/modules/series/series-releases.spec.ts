import type { PrismaService } from '../prisma/prisma.service';
import { loadSeriesReleases, SERIES_RELEASES_LIMIT } from './series-releases';

function rel(id: string, date: string, precision: 'DAY' | 'MONTH' = 'DAY') {
  return {
    id,
    title: `t-${id}`,
    releaseDate: new Date(`${date}T00:00:00.000Z`),
    datePrecision: precision,
    region: 'CN' as const,
    sourceUrl: null,
  };
}

function prismaWith(upcoming: unknown[], past: unknown[]) {
  const findMany = jest.fn().mockResolvedValueOnce(upcoming).mockResolvedValueOnce(past);
  return { prisma: { release: { findMany } } as unknown as PrismaService, findMany };
}

// 2026-11-01 23:30 in Shanghai is still 2026-11-01 there.
const NOW = new Date('2026-11-01T15:30:00.000Z');

describe('loadSeriesReleases (CH-206 §11-4)', () => {
  it('queries upcoming from the Shanghai date ascending, then fills with past newest first', async () => {
    const { prisma, findMany } = prismaWith([rel('u1', '2026-11-05')], [rel('p1', '2026-10-01')]);
    const result = await loadSeriesReleases(prisma, 'S', NOW);
    const up = findMany.mock.calls[0][0];
    expect(up.orderBy).toEqual([{ releaseDate: 'asc' }, { id: 'asc' }]);
    expect(up.take).toBe(SERIES_RELEASES_LIMIT);
    expect(up.where.OR).toEqual([
      { datePrecision: 'DAY', releaseDate: { gte: new Date('2026-11-01T00:00:00.000Z') } },
      { datePrecision: 'MONTH', releaseDate: { gte: new Date('2026-11-01T00:00:00.000Z') } },
    ]);
    const past = findMany.mock.calls[1][0];
    expect(past.orderBy).toEqual([{ releaseDate: 'desc' }, { id: 'desc' }]);
    expect(past.take).toBe(SERIES_RELEASES_LIMIT - 1);
    expect(result.map((r) => [r.id, r.releaseDate])).toEqual([
      ['u1', '2026-11-05'],
      ['p1', '2026-10-01'],
    ]);
  });

  it('counts a MONTH entry for the current month as upcoming', async () => {
    const { prisma, findMany } = prismaWith([], []);
    await loadSeriesReleases(prisma, 'S', new Date('2026-11-20T04:00:00.000Z'));
    const or = findMany.mock.calls[0][0].where.OR;
    expect(or[0].releaseDate.gte).toEqual(new Date('2026-11-20T00:00:00.000Z'));
    expect(or[1].releaseDate.gte).toEqual(new Date('2026-11-01T00:00:00.000Z'));
  });

  it('skips the past query when six upcoming entries exist', async () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => rel(id, '2026-12-01'));
    const { prisma, findMany } = prismaWith(six, []);
    const result = await loadSeriesReleases(prisma, 'S', NOW);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(6);
  });
});
