import { compareSeriesListCards, type SeriesListSortCard } from './card-list-order';

function card(
  overrides: Partial<SeriesListSortCard> & Pick<SeriesListSortCard, 'id'>,
): SeriesListSortCard {
  return {
    name: overrides.name ?? overrides.id,
    rarity: overrides.rarity === undefined ? 'common' : overrides.rarity,
    cardNumber: overrides.cardNumber === undefined ? null : overrides.cardNumber,
    createdAt: overrides.createdAt ?? new Date('2020-01-01T00:00:00.000Z'),
    id: overrides.id,
    slug: overrides.slug ?? overrides.id,
    parallelOfId: overrides.parallelOfId ?? null,
    parallelName: overrides.parallelName ?? null,
    printRun: overrides.printRun === undefined ? null : overrides.printRun,
    subset: overrides.subset === undefined ? null : overrides.subset,
  };
}

describe('compareSeriesListCards', () => {
  it('breaks equal card numbers on id', () => {
    const later = card({ id: 'b', cardNumber: '4' });
    const earlier = card({ id: 'a', cardNumber: '4' });
    expect(compareSeriesListCards('number', later, earlier)).toBeGreaterThan(0);
    expect(compareSeriesListCards('number', earlier, later)).toBeLessThan(0);
  });

  it('keeps two base cards on id when their print runs differ', () => {
    const later = card({ id: 'b', cardNumber: '4', printRun: 1 });
    const earlier = card({ id: 'a', cardNumber: '4', printRun: 99 });
    expect(compareSeriesListCards('number', earlier, later)).toBeLessThan(0);
  });

  it('orders a parallel after the base of the same number, unnumbered then larger print runs', () => {
    const rows = [
      card({
        id: 'low',
        slug: 'low',
        cardNumber: '4',
        parallelOfId: 'base',
        printRun: 2,
        parallelName: 'two',
      }),
      card({ id: 'base', slug: 'base', cardNumber: '4' }),
      card({
        id: 'high-b',
        slug: 'high-b',
        cardNumber: '4',
        parallelOfId: 'base',
        printRun: 10,
        parallelName: 'beta',
      }),
      card({
        id: 'plain',
        slug: 'plain',
        cardNumber: '4',
        parallelOfId: 'base',
        printRun: null,
        parallelName: 'plain',
      }),
      card({
        id: 'high-a',
        slug: 'high-a',
        cardNumber: '4',
        parallelOfId: 'base',
        printRun: 10,
        parallelName: 'alpha',
      }),
      card({ id: 'later-number', slug: 'later-number', cardNumber: '5' }),
      card({
        id: 'earlier-number',
        slug: 'earlier-number',
        cardNumber: '1',
        parallelOfId: 'other',
        printRun: 99,
        parallelName: 'early',
      }),
    ].sort((left, right) => compareSeriesListCards('number', left, right));
    expect(rows.map((row) => row.id)).toEqual([
      'earlier-number',
      'base',
      'plain',
      'high-a',
      'high-b',
      'low',
      'later-number',
    ]);
  });

  it('orders rarity from common to legendary, then unknown text, then blanks', () => {
    const rows = [
      card({ id: 'null-b', rarity: null }),
      card({ id: 'legend', rarity: 'legendary' }),
      card({ id: 'special-b', rarity: 'special' }),
      card({ id: 'common-b', rarity: 'common' }),
      card({ id: 'rare', rarity: 'rare' }),
      card({ id: 'epic', rarity: 'epic' }),
      card({ id: 'common-a', rarity: 'common' }),
      card({ id: 'special-a', rarity: 'mythic' }),
      card({ id: 'null-a', rarity: '  ' }),
    ].sort((left, right) => compareSeriesListCards('rarity', left, right));
    expect(rows.map((row) => row.id)).toEqual([
      'common-a',
      'common-b',
      'rare',
      'epic',
      'legend',
      'special-a',
      'special-b',
      'null-a',
      'null-b',
    ]);
  });

  it('orders names with numeric segments and then id', () => {
    const rows = [
      card({ id: 'b', name: '同名' }),
      card({ id: 'ten', name: '卡10' }),
      card({ id: 'a', name: '同名' }),
      card({ id: 'two', name: '卡2' }),
      card({ id: 'one', name: '卡1' }),
    ].sort((left, right) => compareSeriesListCards('name', left, right));
    const names = rows.map((row) => row.name);
    expect(names.indexOf('卡1')).toBeLessThan(names.indexOf('卡2'));
    expect(names.indexOf('卡2')).toBeLessThan(names.indexOf('卡10'));
    expect(rows.map((row) => row.id).filter((id) => id === 'a' || id === 'b')).toEqual(['a', 'b']);
  });

  it('orders createdAt ascending and puts an invalid timestamp last', () => {
    const rows = [
      card({ id: 'late', createdAt: new Date('2024-01-02T00:00:00.000Z') }),
      card({ id: 'same-b', createdAt: new Date('2024-01-01T00:00:00.000Z') }),
      card({ id: 'bad', createdAt: new Date('not-a-date') }),
      card({ id: 'same-a', createdAt: new Date('2024-01-01T00:00:00.000Z') }),
      card({ id: 'early', createdAt: new Date('2020-01-01T00:00:00.000Z') }),
    ].sort((left, right) => compareSeriesListCards('created', left, right));
    expect(rows.map((row) => row.id)).toEqual(['early', 'same-a', 'same-b', 'late', 'bad']);
  });

  it('orders letter card numbers by subset sortOrder after the numbered cards (CH-237)', () => {
    const special = { sortOrder: 2 };
    const energy = { sortOrder: 3 };
    const rows = [
      card({ id: 'wat', cardNumber: 'WAT', subset: energy }),
      card({ id: 'r', cardNumber: 'R', subset: special }),
      card({ id: 'dar', cardNumber: 'DAR', subset: energy }),
      card({ id: 'n10', cardNumber: '010', subset: { sortOrder: 1 } }),
      card({ id: 'b', cardNumber: 'B', subset: special }),
      card({ id: 'loose', cardNumber: 'A', subset: null }),
      card({ id: 'n2', cardNumber: '002', subset: { sortOrder: 0 } }),
      card({ id: 'g', cardNumber: 'G', subset: special }),
    ].sort((left, right) => compareSeriesListCards('number', left, right));
    expect(rows.map((row) => row.id)).toEqual(['n2', 'n10', 'b', 'g', 'r', 'dar', 'wat', 'loose']);
  });

  it('leaves name, rarity, and created order alone when subsets differ (CH-237 Out)', () => {
    const rows = [
      card({ id: 'z', name: 'A', rarity: 'common', cardNumber: 'Z', subset: { sortOrder: 0 } }),
      card({ id: 'a', name: 'B', rarity: 'common', cardNumber: 'A', subset: { sortOrder: 9 } }),
    ];
    const byName = [...rows].sort((left, right) => compareSeriesListCards('name', left, right));
    expect(byName.map((row) => row.id)).toEqual(['z', 'a']);
    const byRarity = [...rows].sort((left, right) => compareSeriesListCards('rarity', left, right));
    expect(byRarity.map((row) => row.id)).toEqual(['a', 'z']);
  });
});
