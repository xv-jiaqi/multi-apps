import { relevanceTier, sortByRelevance, type RelevanceSortCard } from './search-relevance';

function card(
  id: string,
  name: string,
  cardNumber: string | null,
  series: { slug: string; releaseDate: string | null },
  extra: Partial<RelevanceSortCard> = {},
): RelevanceSortCard {
  return {
    id,
    slug: id,
    name,
    rarity: null,
    cardNumber,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    parallelOfId: null,
    parallelName: null,
    printRun: null,
    subset: null,
    series: {
      slug: series.slug,
      releaseDate: series.releaseDate ? new Date(`${series.releaseDate}T00:00:00Z`) : null,
    },
    ...extra,
  };
}

const s30th = { slug: 'ptcg-sc-30th', releaseDate: '2026-09-16' };
const s151 = { slug: 'ptcg-sc-151', releaseDate: '2025-01-17' };
const undated = { slug: 'aaa-undated', releaseDate: null };

describe('relevanceTier (CH-241 §1)', () => {
  it('ranks exact name, then prefix, then any other hit', () => {
    expect(relevanceTier('皮卡丘', '皮卡丘')).toBe(0);
    expect(relevanceTier('皮卡丘ex', '皮卡丘')).toBe(1);
    expect(relevanceTier('雷丘与皮卡丘', '皮卡丘')).toBe(2);
    expect(relevanceTier('鸭嘴火兽', '025')).toBe(2);
  });

  it('compares case-insensitively like the ILIKE match', () => {
    expect(relevanceTier('EX', 'ex')).toBe(0);
    expect(relevanceTier('Ex Trainer', 'eX')).toBe(1);
  });

  it('puts every card in the last tier without a bare word', () => {
    expect(relevanceTier('皮卡丘', undefined)).toBe(2);
  });
});

describe('sortByRelevance (CH-241 §1)', () => {
  it('orders tiers, then newer release first, then card number within a series', () => {
    const rows = [
      card('151-173', '皮卡丘', '173', s151),
      card('30th-047', '皮卡丘ex', '047', s30th),
      card('151-025', '皮卡丘', '025', s151),
      card('30th-018', '皮卡丘', '018', s30th),
      card('30th-136', '皮卡丘', '136', s30th),
      card('30th-017', '皮卡丘', '017', s30th),
      card('x-1', '雷丘与皮卡丘', '1', s30th),
    ];
    expect(sortByRelevance(rows, '皮卡丘').map((row) => row.id)).toEqual([
      '30th-017',
      '30th-018',
      '30th-136',
      '151-025',
      '151-173',
      '30th-047',
      'x-1',
    ]);
  });

  it('puts a series without a release date last within its tier', () => {
    const rows = [
      card('u-1', '皮卡丘', '1', undated),
      card('o-2', '皮卡丘', '2', s151),
      card('n-3', '皮卡丘', '3', s30th),
    ];
    expect(sortByRelevance(rows, '皮卡丘').map((row) => row.id)).toEqual(['n-3', 'o-2', 'u-1']);
  });

  it('keeps two series with the same release date apart by slug', () => {
    const a = { slug: 'b-series', releaseDate: '2026-01-01' };
    const b = { slug: 'a-series', releaseDate: '2026-01-01' };
    const rows = [card('b1', 'x', '1', a), card('a2', 'x', '2', b), card('a1', 'x', '1', b)];
    expect(sortByRelevance(rows, undefined).map((row) => row.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('uses the series page number order: numbers, then letter numbers by subset, then blanks', () => {
    const rows = [
      card('blank', 'x', null, s30th),
      card('dar', 'x', 'DAR', s30th, { subset: { sortOrder: 3 } }),
      card('b', 'x', 'B', s30th, { subset: { sortOrder: 2 } }),
      card('n10', 'x', '10', s30th),
      card('n2', 'x', '2', s30th),
    ];
    expect(sortByRelevance(rows, undefined).map((row) => row.id)).toEqual([
      'n2',
      'n10',
      'b',
      'dar',
      'blank',
    ]);
  });

  it('is a total order: equal keys break on id, input order does not matter', () => {
    const rows = [card('b', '皮卡丘', '1', s30th), card('a', '皮卡丘', '1', s30th)];
    expect(sortByRelevance(rows, '皮卡丘').map((row) => row.id)).toEqual(['a', 'b']);
    expect(sortByRelevance([...rows].reverse(), '皮卡丘').map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('does not mutate its input', () => {
    const rows = [card('b', 'x', '2', s30th), card('a', 'x', '1', s30th)];
    sortByRelevance(rows, undefined);
    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
  });
});
