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
  };
}

describe('compareSeriesListCards', () => {
  it('breaks equal card numbers on id', () => {
    const later = card({ id: 'b', cardNumber: '4' });
    const earlier = card({ id: 'a', cardNumber: '4' });
    expect(compareSeriesListCards('number', later, earlier)).toBeGreaterThan(0);
    expect(compareSeriesListCards('number', earlier, later)).toBeLessThan(0);
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
});
