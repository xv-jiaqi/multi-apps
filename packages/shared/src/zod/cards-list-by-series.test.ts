import { describe, expect, it } from 'vitest';
import '../configure-zod';
import { CARD_SERIES_LIST_PAGE_SIZE_DEFAULT, cardsListBySeriesInput } from './index';

describe('cardsListBySeriesInput', () => {
  it('defaults sort, page, and page size', () => {
    expect(cardsListBySeriesInput.parse({ seriesSlug: 'celestial-dawn' })).toEqual({
      seriesSlug: 'celestial-dawn',
      sort: 'number',
      page: 1,
      pageSize: CARD_SERIES_LIST_PAGE_SIZE_DEFAULT,
      includeParallels: false,
    });
    expect(
      cardsListBySeriesInput.parse({ seriesSlug: 'celestial-dawn', includeParallels: true })
        .includeParallels,
    ).toBe(true);
  });

  it('treats a blank keyword as omitted and trims the rest', () => {
    expect(
      cardsListBySeriesInput.parse({ seriesSlug: 'celestial-dawn', q: '   ' }).q,
    ).toBeUndefined();
    expect(cardsListBySeriesInput.parse({ seriesSlug: 'celestial-dawn', q: '  卡10  ' }).q).toBe(
      '卡10',
    );
  });

  it('trims rarityCode, treats blank as omitted, and counts code points (CH-239)', () => {
    const parse = (rarityCode: unknown) =>
      cardsListBySeriesInput.safeParse({ seriesSlug: 'ptcg-sc-30th', rarityCode });
    const value = (rarityCode: unknown) => {
      const parsed = parse(rarityCode);
      if (!parsed.success) throw new Error('expected success');
      return parsed.data.rarityCode;
    };
    expect(cardsListBySeriesInput.parse({ seriesSlug: 'ptcg-sc-30th' }).rarityCode).toBeUndefined();
    expect(value('SAR')).toBe('SAR');
    expect(value('  ★★★ ')).toBe('★★★');
    expect(value('无标记')).toBe('无标记');
    expect(value('   ')).toBeUndefined();
    expect(value('')).toBeUndefined();
    expect(value(` ${'稀'.repeat(10)} `)).toBe('稀'.repeat(10));
    // 10 astral code points are 20 UTF-16 units and still fit.
    expect(value('🂡'.repeat(10))).toBe('🂡'.repeat(10));
    expect(parse('🂡'.repeat(11)).success).toBe(false);
  });

  it('rejects illegal paging, filters, and slugs with snake_case issue messages', () => {
    const cases: Array<{ input: unknown; path: string; message: string }> = [
      { input: { seriesSlug: 'ok', page: 0 }, path: 'page', message: 'too_small' },
      { input: { seriesSlug: 'ok', page: 1.5 }, path: 'page', message: 'invalid_type' },
      { input: { seriesSlug: 'ok', page: '1' }, path: 'page', message: 'invalid_type' },
      { input: { seriesSlug: 'ok', page: 10_001 }, path: 'page', message: 'too_big' },
      { input: { seriesSlug: 'ok', pageSize: 0 }, path: 'pageSize', message: 'too_small' },
      { input: { seriesSlug: 'ok', pageSize: 101 }, path: 'pageSize', message: 'too_big' },
      { input: { seriesSlug: 'ok', rarity: 'mythic' }, path: 'rarity', message: 'invalid_value' },
      { input: { seriesSlug: 'ok', sort: 'id' }, path: 'sort', message: 'invalid_value' },
      { input: { seriesSlug: 'Not A Slug' }, path: 'seriesSlug', message: 'slug_format' },
      { input: { seriesSlug: 'ok', q: 'x'.repeat(201) }, path: 'q', message: 'too_big' },
      { input: { seriesSlug: 'ok', q: null }, path: 'q', message: 'invalid_type' },
      {
        input: { seriesSlug: 'ok', rarityCode: 'X'.repeat(11) },
        path: 'rarityCode',
        message: 'too_big',
      },
      {
        input: { seriesSlug: 'ok', rarityCode: '稀'.repeat(11) },
        path: 'rarityCode',
        message: 'too_big',
      },
      { input: { seriesSlug: 'ok', rarityCode: 1 }, path: 'rarityCode', message: 'invalid_type' },
      {
        input: { seriesSlug: 'ok', rarityCode: null },
        path: 'rarityCode',
        message: 'invalid_type',
      },
      { input: {}, path: 'seriesSlug', message: 'invalid_type' },
    ];

    for (const sample of cases) {
      const parsed = cardsListBySeriesInput.safeParse(sample.input);
      expect(parsed.success).toBe(false);
      if (parsed.success) continue;
      const issue = parsed.error.issues.find((item) => item.path[0] === sample.path);
      expect(issue?.message).toBe(sample.message);
      expect(issue?.message).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });
});
