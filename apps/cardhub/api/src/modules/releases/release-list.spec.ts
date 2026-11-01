import { parseShanghaiCivilDate } from '@repo/shared';
import {
  adminReleaseWhere,
  publicReleaseWhere,
  releaseItemSelect,
  releaseKeysetWhere,
  releaseOrderBy,
  shanghaiMonthStart,
} from './release-list';

function day(isoDate: string): Date {
  const parsed = parseShanghaiCivilDate(isoDate);
  if (!parsed) throw new Error(`invalid date ${isoDate}`);
  return parsed;
}

describe('release list query', () => {
  const point = { releaseDate: day('2026-11-06'), id: '00000000-0000-4000-8000-00000000000b' };

  it('orders the public list ascending and the admin list descending', () => {
    expect(releaseOrderBy('asc')).toEqual([{ releaseDate: 'asc' }, { id: 'asc' }]);
    expect(releaseOrderBy('desc')).toEqual([{ releaseDate: 'desc' }, { id: 'desc' }]);
  });

  it('keeps the public range closed and pages forward inside it', () => {
    expect(
      publicReleaseWhere({
        from: day('2026-11-15'),
        to: day('2026-11-30'),
        categorySlug: 'deck-builder',
        cursor: point,
      }),
    ).toEqual({
      AND: [
        {
          OR: [
            {
              datePrecision: 'DAY',
              releaseDate: { gte: day('2026-11-15'), lte: day('2026-11-30') },
            },
            {
              datePrecision: 'MONTH',
              releaseDate: { gte: day('2026-11-01'), lte: day('2026-11-30') },
            },
          ],
        },
        { category: { slug: 'deck-builder' } },
        releaseKeysetWhere(point, 'asc'),
      ],
    });
    expect(shanghaiMonthStart(day('2026-11-15'))).toEqual(day('2026-11-01'));
    expect(releaseKeysetWhere(point, 'asc')).toEqual({
      OR: [
        { releaseDate: { gt: point.releaseDate } },
        { releaseDate: point.releaseDate, id: { gt: point.id } },
      ],
    });
  });

  it('pages the admin list backward, including past rows', () => {
    expect(adminReleaseWhere(undefined)).toEqual({});
    expect(adminReleaseWhere(point)).toEqual(releaseKeysetWhere(point, 'desc'));
    expect(releaseKeysetWhere(point, 'desc')).toEqual({
      OR: [
        { releaseDate: { lt: point.releaseDate } },
        { releaseDate: point.releaseDate, id: { lt: point.id } },
      ],
    });
  });

  it('loads series and category in the list select', () => {
    expect(releaseItemSelect.series).toEqual({
      select: { slug: true, title: true, coverUrl: true },
    });
    expect(releaseItemSelect.category).toEqual({ select: { slug: true, name: true } });
    expect(releaseItemSelect).not.toHaveProperty('imageUrl');
    expect(releaseItemSelect).not.toHaveProperty('status');
  });
});
