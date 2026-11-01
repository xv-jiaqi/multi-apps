import { describe, expect, it } from 'vitest';
import '../configure-zod';
import { fieldErrorMessage } from '../i18n';
import { slugSchema } from './index';
import {
  RELEASE_LIST_LIMIT_DEFAULT,
  RELEASE_SOURCE_URL_MAX,
  adminReleasesListInput,
  parseShanghaiCivilDate,
  releaseCreateInput,
  releasesListInput,
  shanghaiCivilDate,
  shanghaiMonthBounds,
  shanghaiYearMonth,
  storedReleaseDate,
} from './release';

function messages(
  input: unknown,
  schema: {
    safeParse: (value: unknown) => {
      success: boolean;
      error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
    };
  },
) {
  const parsed = schema.safeParse(input);
  if (parsed.success || !parsed.error) return [];
  return parsed.error.issues.map((issue) => ({
    path: issue.path.map((part) => String(part)).join('.'),
    message: issue.message,
  }));
}

describe('Asia/Shanghai release dates', () => {
  it('keeps a civil day on UTC midnight and rejects slashes', () => {
    const parsed = parseShanghaiCivilDate('2026-11-06');
    expect(parsed?.toISOString()).toBe('2026-11-06T00:00:00.000Z');
    expect(parseShanghaiCivilDate(' 2026-11-06 ')).toEqual(parsed);
    expect(parseShanghaiCivilDate('2026/11/06')).toBeNull();
    expect(parseShanghaiCivilDate('2026.11.06')).toBeNull();
    expect(parseShanghaiCivilDate('2026-11-06T00:00:00Z')).toBeNull();
    expect(parseShanghaiCivilDate('2026-02-31')).toBeNull();
    expect(parseShanghaiCivilDate('')).toBeNull();
  });

  it('maps a calendar month to a closed civil interval', () => {
    expect(shanghaiMonthBounds('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(shanghaiMonthBounds('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(shanghaiMonthBounds('2025-02')).toEqual({ from: '2025-02-01', to: '2025-02-28' });
    expect(shanghaiMonthBounds('1900-02')).toEqual({ from: '1900-02-01', to: '1900-02-28' });
    expect(shanghaiMonthBounds('2000-02')).toEqual({ from: '2000-02-01', to: '2000-02-29' });
    expect(shanghaiMonthBounds('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(shanghaiMonthBounds('2026-13')).toBeNull();
    expect(shanghaiMonthBounds('2026-00')).toBeNull();
    expect(shanghaiMonthBounds('2026-1')).toBeNull();
    expect(shanghaiMonthBounds('0000-01')).toBeNull();
  });

  it('uses Asia/Shanghai around the UTC date boundary', () => {
    const stillOctober = new Date('2026-10-31T15:59:59.000Z');
    const november = new Date('2026-10-31T16:00:00.000Z');
    const december = new Date('2026-11-30T16:00:00.000Z');
    expect(shanghaiCivilDate(stillOctober)).toBe('2026-10-31');
    expect(shanghaiYearMonth(stillOctober)).toBe('2026-10');
    expect(shanghaiCivilDate(november)).toBe('2026-11-01');
    expect(shanghaiYearMonth(november)).toBe('2026-11');
    expect(shanghaiCivilDate(december)).toBe('2026-12-01');

    const bounds = shanghaiMonthBounds(shanghaiYearMonth(november));
    expect(bounds?.from).toBe('2026-11-01');
    expect(bounds?.to).toBe('2026-11-30');
    expect(shanghaiCivilDate(november) >= (bounds?.from ?? '')).toBe(true);
    expect(shanghaiCivilDate(november) <= (bounds?.to ?? '')).toBe(true);
    expect(shanghaiCivilDate(stillOctober) < (bounds?.from ?? '')).toBe(true);
  });

  it('stores MONTH precision on the first civil day', () => {
    expect(storedReleaseDate('2026-11-15', 'MONTH')?.toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(storedReleaseDate('2026-11-15', 'DAY')?.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    expect(storedReleaseDate('2026/11/15', 'MONTH')).toBeNull();
  });
});

describe('release input validation', () => {
  const valid = {
    title: '夜航',
    releaseDate: '2026-11-06',
    sourceUrl: 'https://example.com/source',
  };

  it('accepts a day release and defaults precision', () => {
    expect(releaseCreateInput.parse(valid)).toMatchObject({
      title: '夜航',
      releaseDate: '2026-11-06',
      datePrecision: 'DAY',
      sourceUrl: 'https://example.com/source',
    });
    expect(releaseCreateInput.parse({ ...valid, region: null }).region).toBeNull();
    expect(releaseCreateInput.parse(valid).region).toBeUndefined();
    expect(releaseCreateInput.parse({ ...valid, note: '  ' }).note).toBeNull();
  });

  it('rejects empty region, slash dates, and non-https sources with spec codes', () => {
    expect(messages({ ...valid, region: '' }, releaseCreateInput)).toEqual([
      { path: 'region', message: 'release_region' },
    ]);
    expect(messages({ ...valid, region: 'US' }, releaseCreateInput)).toEqual([
      { path: 'region', message: 'release_region' },
    ]);
    expect(messages({ ...valid, releaseDate: '2026/11/06' }, releaseCreateInput)).toEqual([
      { path: 'releaseDate', message: 'invalid_date' },
    ]);
    expect(messages({ ...valid, releaseDate: '' }, releaseCreateInput)).toEqual([
      { path: 'releaseDate', message: 'invalid_date' },
    ]);
    expect(messages({ ...valid, title: '   ' }, releaseCreateInput)).toEqual([
      { path: 'title', message: 'title_required' },
    ]);
    expect(messages({ ...valid, title: '题'.repeat(121) }, releaseCreateInput)).toEqual([
      { path: 'title', message: 'title_too_long' },
    ]);
    expect(messages({ ...valid, note: '注'.repeat(501) }, releaseCreateInput)).toEqual([
      { path: 'note', message: 'note_too_long' },
    ]);
    expect(messages({ ...valid, sourceUrl: 'http://example.com/a' }, releaseCreateInput)).toEqual([
      { path: 'sourceUrl', message: 'source_url' },
    ]);
    expect(messages({ ...valid, sourceUrl: '' }, releaseCreateInput)).toEqual([
      { path: 'sourceUrl', message: 'source_url' },
    ]);
    expect(
      messages(
        { ...valid, sourceUrl: `https://example.com/${'a'.repeat(RELEASE_SOURCE_URL_MAX)}` },
        releaseCreateInput,
      ),
    ).toEqual([{ path: 'sourceUrl', message: 'too_big' }]);
    expect(messages({ ...valid, seriesId: '' }, releaseCreateInput)).toEqual([
      { path: 'seriesId', message: 'invalid_format' },
    ]);
    expect(messages({ ...valid, datePrecision: 'YEAR' }, releaseCreateInput)).toEqual([
      { path: 'datePrecision', message: 'invalid_value' },
    ]);
  });

  it('requires a closed from/to span of at most 366 Shanghai days', () => {
    const november = shanghaiMonthBounds('2026-11');
    expect(releasesListInput.parse({ from: november?.from, to: november?.to })).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(releasesListInput.safeParse({ from: '2024-01-01', to: '2024-12-31' }).success).toBe(
      true,
    );
    expect(messages({}, releasesListInput)).toEqual([
      { path: 'from', message: 'invalid_type' },
      { path: 'to', message: 'invalid_type' },
    ]);
    expect(messages({ from: '2026-11-01' }, releasesListInput)).toEqual([
      { path: 'to', message: 'invalid_type' },
    ]);
    expect(messages({ from: '2026/11/06', to: '2026-11-30' }, releasesListInput)).toEqual([
      { path: 'from', message: 'invalid_date' },
    ]);
    expect(messages({ from: '2026-11-06', to: '2026-11-01' }, releasesListInput)).toEqual([
      { path: 'to', message: 'release_range_order' },
    ]);
    expect(messages({ from: '2024-01-01', to: '2025-01-01' }, releasesListInput)).toEqual([
      { path: 'to', message: 'release_range_too_long' },
    ]);
    expect(
      messages(
        { from: '2026-11-01', to: '2026-11-30', categorySlug: 'Not A Slug' },
        releasesListInput,
      ),
    ).toEqual([{ path: 'categorySlug', message: 'slug_format' }]);
    expect(slugSchema.safeParse('deck-builder').success).toBe(true);
    expect(
      releasesListInput.safeParse({
        from: '2026-11-01',
        to: '2026-11-30',
        categorySlug: 'deck-builder',
      }).success,
    ).toBe(true);
  });

  it('defaults the admin limit to 50 and rejects out-of-range numbers', () => {
    expect(adminReleasesListInput.parse({})).toEqual({ limit: RELEASE_LIST_LIMIT_DEFAULT });
    expect(adminReleasesListInput.parse({ limit: 100 }).limit).toBe(100);
    expect(messages({ limit: 0 }, adminReleasesListInput)).toEqual([
      { path: 'limit', message: 'too_small' },
    ]);
    expect(messages({ limit: 101 }, adminReleasesListInput)).toEqual([
      { path: 'limit', message: 'too_big' },
    ]);
    expect(messages({ limit: 1.5 }, adminReleasesListInput)).toEqual([
      { path: 'limit', message: 'invalid_type' },
    ]);
    expect(messages({ limit: '50' }, adminReleasesListInput)).toEqual([
      { path: 'limit', message: 'invalid_type' },
    ]);
    expect(messages({ limit: 2, cursor: '' }, adminReleasesListInput)).toEqual([
      { path: 'cursor', message: 'too_small' },
    ]);
  });

  it('maps the new field codes to §7 sentences', () => {
    expect(fieldErrorMessage('zh-CN', 'release_region')).toBe('地区只能选中国大陆、日本或全球');
    expect(fieldErrorMessage('en-US', 'release_region')).toBe(
      'Choose China mainland, Japan, or Global.',
    );
    expect(fieldErrorMessage('zh-CN', 'source_url')).toBe('来源链接必须以 https:// 开头');
    expect(fieldErrorMessage('en-US', 'source_url')).toBe('Start the source link with https://.');
    expect(fieldErrorMessage('zh-CN', 'invalid_date')).toBe('日期必须是有效的 YYYY-MM-DD');
    expect(fieldErrorMessage('zh-CN', 'note_too_long')).toBe('说明最多 500 个字符');
    expect(fieldErrorMessage('en-US', 'note_too_long')).toBe(
      'Use at most 500 characters for the note.',
    );
  });
});
