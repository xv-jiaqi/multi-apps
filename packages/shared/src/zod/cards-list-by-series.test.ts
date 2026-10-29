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
    });
  });

  it('treats a blank keyword as omitted and trims the rest', () => {
    expect(
      cardsListBySeriesInput.parse({ seriesSlug: 'celestial-dawn', q: '   ' }).q,
    ).toBeUndefined();
    expect(cardsListBySeriesInput.parse({ seriesSlug: 'celestial-dawn', q: '  卡10  ' }).q).toBe(
      '卡10',
    );
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
