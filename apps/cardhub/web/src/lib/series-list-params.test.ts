import { describe, expect, it } from 'vitest';
import {
  pageTokens,
  parseSeriesListParams,
  seriesCardAttributeLine,
  seriesListSearch,
} from './series-list-params';

const subsets = new Set(['base', 'insert']);

describe('parseSeriesListParams rarityCode (Spec CH-239 v1.2 §1 §2)', () => {
  const codes = ['C', 'R', 'RR', '无标记', 'AR', 'SAR', 'FUR'];

  it('keeps a well-formed code while rarityCodes is unknown and passes it on', () => {
    const parsed = parseSeriesListParams(
      new URLSearchParams('rarityCode=sar&rarity=epic'),
      subsets,
    );
    expect(parsed.state.rarityCode).toBe('sar');
    expect(parsed.state.rarity).toBe('epic');
    expect(parsed.replace).toBe(false);
  });

  it('drops a blank or over-long code at once, counting code points', () => {
    for (const raw of ['%20%20', '', 'ABCDEFGHIJK', encodeURIComponent('稀'.repeat(11))]) {
      const parsed = parseSeriesListParams(
        new URLSearchParams(`rarityCode=${raw}&page=2`),
        subsets,
      );
      expect(parsed.state.rarityCode).toBeNull();
      expect(parsed.search).toBe('page=2');
      expect(parsed.replace).toBe(true);
    }
    const astral = parseSeriesListParams(
      new URLSearchParams({ rarityCode: '🂡'.repeat(10) }),
      subsets,
    );
    expect(astral.state.rarityCode).toBe('🂡'.repeat(10));
    expect(astral.replace).toBe(false);
  });

  it('trims the code in the URL', () => {
    const parsed = parseSeriesListParams(
      new URLSearchParams({ rarityCode: ' SAR ' }),
      subsets,
      codes,
    );
    expect(parsed.state.rarityCode).toBe('SAR');
    expect(parsed.search).toBe('rarityCode=SAR');
    expect(parsed.replace).toBe(true);
  });

  it('matches case-sensitively and drops a code the series does not have', () => {
    for (const raw of ['sar', 'XYZ', 'Sar']) {
      const parsed = parseSeriesListParams(
        new URLSearchParams({ rarityCode: raw, sort: 'name' }),
        subsets,
        codes,
      );
      expect(parsed.state.rarityCode).toBeNull();
      expect(parsed.search).toBe('sort=name');
      expect(parsed.replace).toBe(true);
    }
  });

  it('keeps a code from the full list even if it is not offered right now', () => {
    // A parallel-only code is in the full rarityCodes; the page decides offers.
    const parsed = parseSeriesListParams(
      new URLSearchParams({ rarityCode: 'SSR', parallels: '1' }),
      subsets,
      ['C', 'SSR'],
    );
    expect(parsed.state.rarityCode).toBe('SSR');
    expect(parsed.replace).toBe(false);
  });

  it('drops the 4-tier rarity once the series has official codes', () => {
    const parsed = parseSeriesListParams(
      new URLSearchParams({ rarity: 'legendary', rarityCode: 'SAR' }),
      subsets,
      codes,
    );
    expect(parsed.state.rarity).toBeNull();
    expect(parsed.state.rarityCode).toBe('SAR');
    expect(parsed.search).toBe('rarityCode=SAR');
    expect(parsed.replace).toBe(true);
  });

  it('drops rarityCode and keeps the 4-tier rarity when the series has no codes', () => {
    const parsed = parseSeriesListParams(
      new URLSearchParams({ rarity: 'rare', rarityCode: 'SAR' }),
      subsets,
      [],
    );
    expect(parsed.state.rarity).toBe('rare');
    expect(parsed.state.rarityCode).toBeNull();
    expect(parsed.search).toBe('rarity=rare');
  });

  it('writes symbol and Chinese codes through URLSearchParams', () => {
    const search = seriesListSearch({
      q: '',
      subset: null,
      rarity: null,
      rarityCode: '★★★',
      sort: 'number',
      page: 1,
      parallels: false,
    });
    expect(search).toBe(`rarityCode=${encodeURIComponent('★★★')}`);
    expect(new URLSearchParams(search).get('rarityCode')).toBe('★★★');
  });
});

describe('parseSeriesListParams', () => {
  it('omits defaults and drops unknown values', () => {
    const parsed = parseSeriesListParams(
      new URLSearchParams('q=%20%20&subset=missing&rarity=mythic&sort=number&page=1'),
      subsets,
    );
    expect(parsed.state).toEqual({
      q: '',
      subset: null,
      rarity: null,
      rarityCode: null,
      sort: 'number',
      page: 1,
      parallels: false,
    });
    expect(parsed.search).toBe('');
    expect(parsed.replace).toBe(true);
  });

  it('keeps a subset query while the subset list is not loaded yet', () => {
    const parsed = parseSeriesListParams(new URLSearchParams('subset=base&page=2'), null);
    expect(parsed.state.subset).toBe('base');
    expect(parsed.state.page).toBe(2);
    expect(parsed.replace).toBe(false);
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
      rarityCode: null,
      sort: 'name',
      page: 2,
      parallels: false,
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

  it('keeps parallels=1 and deletes every other value', () => {
    const on = parseSeriesListParams(new URLSearchParams('parallels=1&page=3'), subsets);
    expect(on.state.parallels).toBe(true);
    expect(on.state.page).toBe(3);
    expect(on.replace).toBe(false);
    expect(seriesListSearch(on.state)).toBe('page=3&parallels=1');
    for (const raw of ['0', 'true', 'yes']) {
      const parsed = parseSeriesListParams(new URLSearchParams(`parallels=${raw}`), subsets);
      expect(parsed.state.parallels).toBe(false);
      expect(parsed.search).toBe('');
      expect(parsed.replace).toBe(true);
    }
    expect(seriesListSearch({ ...on.state, parallels: false, page: 1 })).toBe('');
  });

  it('caps page=10001 at 10000 so the list request stays valid', () => {
    const parsed = parseSeriesListParams(new URLSearchParams('q=龙&page=10001'), subsets);
    expect(parsed.state.page).toBe(10_000);
    expect(parsed.search).toBe('q=%E9%BE%99&page=10000');
    expect(parsed.replace).toBe(true);
    const atMax = parseSeriesListParams(new URLSearchParams('page=10000'), subsets);
    expect(atMax.state.page).toBe(10_000);
    expect(atMax.search).toBe('page=10000');
    expect(atMax.replace).toBe(false);
    expect(parseSeriesListParams(new URLSearchParams('page=100000'), subsets).state.page).toBe(
      10_000,
    );
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
