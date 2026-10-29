import { describe, expect, it } from 'vitest';
import { displayCardNumber, groupSeriesCards, sortTaxonomyCards } from './catalog-taxonomy';

const card = (slug: string, name: string, cardNumber?: string, subsetSlug?: string) => ({
  slug,
  name,
  cardNumber: cardNumber ?? null,
  subsetSlug: subsetSlug ?? null,
});

describe('sortTaxonomyCards', () => {
  it('sorts numbers as strings and puts blank numbers last, then by name', () => {
    const sorted = sortTaxonomyCards([
      card('b', 'Beta', '10'),
      card('plain', '无号'),
      card('a', 'Alpha', '2'),
      card('z', 'Zed'),
      card('c', 'Gamma', '2'),
    ]);
    expect(sorted.map((item) => item.slug)).toEqual(['b', 'a', 'c', 'z', 'plain']);
  });
});

describe('groupSeriesCards', () => {
  it('returns a flat list when the series has no subsets', () => {
    const result = groupSeriesCards([], [card('b', 'B', '2'), card('a', 'A')]);
    expect(result.flat).toBe(true);
    expect(result.groups).toEqual([]);
  });

  it('groups by subset order, skips empty subsets, and puts ungrouped cards last', () => {
    const result = groupSeriesCards(
      [
        { slug: 'inserts', name: '异画', kind: 'INSERT', sortOrder: 2 },
        { slug: 'empty', name: '空', kind: 'BASE', sortOrder: 1 },
        { slug: 'base', name: '主卡', kind: 'BASE', sortOrder: 0 },
      ],
      [
        card('i', 'Insert', 'I01', 'inserts'),
        card('old', '旧卡'),
        card('b', 'Base', '001', 'base'),
      ],
    );
    expect(result.flat).toBe(false);
    expect(result.groups.map((group) => group.id)).toEqual(['base', 'inserts', 'ungrouped']);
    expect(result.groups[0]?.cards.map((item) => item.slug)).toEqual(['b']);
    expect(result.groups[2]?.kind).toBe('UNGROUPED');
  });
});

describe('displayCardNumber', () => {
  it('prefixes a hash once', () => {
    expect(displayCardNumber('001')).toBe('#001');
    expect(displayCardNumber('#010')).toBe('#010');
  });
});
