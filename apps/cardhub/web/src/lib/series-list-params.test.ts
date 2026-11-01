import { describe, expect, it } from 'vitest';
import {
  pageTokens,
  parseSeriesListParams,
  seriesCardAttributeLine,
  seriesListSearch,
} from './series-list-params';

const subsets = new Set(['base', 'insert']);

describe('parseSeriesListParams', () => {
  it('omits defaults and drops unknown values', () => {
    const parsed = parseSeriesListParams(
      new URLSearchParams('q=%20%20&subset=missing&rarity=mythic&sort=number&page=1'),
      subsets,
    );
    expect(parsed.state).toEqual({ q: '', subset: null, rarity: null, sort: 'number', page: 1 });
    expect(parsed.search).toBe('');
    expect(parsed.replace).toBe(true);
  });

  it('keeps a real filter and a positive page', () => {
    const parsed = parseSeriesListParams(
      new URLSearchParams('q=龙&subset=base&rarity=rare&sort=name&page=2'),
      subsets,
    );
    expect(parsed.replace).toBe(false);
    expect(parsed.state).toEqual({
      q: '龙',
      subset: 'base',
      rarity: 'rare',
      sort: 'name',
      page: 2,
    });
    expect(seriesListSearch(parsed.state)).toBe(
      'q=%E9%BE%99&subset=base&rarity=rare&sort=name&page=2',
    );
  });

  it('truncates q to 200 characters', () => {
    const parsed = parseSeriesListParams(new URLSearchParams({ q: 'a'.repeat(201) }), subsets);
    expect(parsed.state.q).toHaveLength(200);
    expect(parsed.replace).toBe(true);
  });

  it('rejects a page that is not a positive integer', () => {
    expect(parseSeriesListParams(new URLSearchParams('page=0'), subsets).state.page).toBe(1);
    expect(parseSeriesListParams(new URLSearchParams('page=1.5'), subsets).state.page).toBe(1);
    expect(parseSeriesListParams(new URLSearchParams('page=01'), subsets).replace).toBe(true);
  });
});

describe('pageTokens', () => {
  it('shows the ends and the current page neighbors', () => {
    expect(pageTokens(5, 10).map((token) => (token.kind === 'page' ? token.page : '…'))).toEqual([
      1,
      '…',
      4,
      5,
      6,
      '…',
      10,
    ]);
    expect(pageTokens(1, 1)).toEqual([{ kind: 'page', page: 1 }]);
  });
});

describe('seriesCardAttributeLine', () => {
  it('prints known numeric keys in cost, attack, health order', () => {
    expect(
      seriesCardAttributeLine(
        { health: 4, attack: 2, cost: 3, type: '随从' },
        {
          cost: { 'zh-CN': '费用', 'en-US': 'Cost' },
          attack: { 'zh-CN': '攻击', 'en-US': 'Attack' },
          health: { 'zh-CN': '生命', 'en-US': 'Health' },
        },
        'zh-CN',
      ),
    ).toBe('费用 3 · 攻击 2 · 生命 4');
    expect(seriesCardAttributeLine({ attack: 2 }, undefined, 'en-US')).toBe('Attack 2');
    expect(seriesCardAttributeLine({ type: '随从' }, undefined, 'zh-CN')).toBeNull();
  });
});
