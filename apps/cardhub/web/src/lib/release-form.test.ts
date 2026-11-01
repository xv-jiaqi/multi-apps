import { describe, expect, it } from 'vitest';
import {
  normalizeReleaseDateInput,
  releaseFormErrors,
  releaseWriteFeedback,
  releaseWriteInput,
  type ReleaseFormValues,
} from './release-form';

const empty: ReleaseFormValues = {
  title: '春季补充包',
  releaseDate: '2026-11-06',
  monthOnly: false,
  region: 'JP',
  seriesId: null,
  categoryId: null,
  note: '',
  sourceUrl: '',
};

function codes(locale: 'zh-CN' | 'en-US', values: ReleaseFormValues) {
  return releaseFormErrors(values, locale);
}

describe('release form values', () => {
  it('turns slashes and dots into dashes and stores a month as the first day', () => {
    expect(normalizeReleaseDateInput(' 2026/11/06 ', false)).toBe('2026-11-06');
    expect(normalizeReleaseDateInput('2026.11.06', false)).toBe('2026-11-06');
    expect(normalizeReleaseDateInput('2026/1/6', false)).toBe('2026-01-06');
    expect(normalizeReleaseDateInput('2026/11/06', true)).toBe('2026-11');
    expect(releaseWriteInput({ ...empty, releaseDate: '2026/11', monthOnly: true })).toMatchObject({
      releaseDate: '2026-11-01',
      datePrecision: 'MONTH',
      region: 'JP',
      note: null,
      sourceUrl: null,
    });
    expect(releaseWriteInput({ ...empty, region: '' }).region).toBeNull();
  });

  it('uses the §7 sentences in both languages and hides the codes', () => {
    const invalid = {
      ...empty,
      title: '',
      releaseDate: '2026/02/31',
      sourceUrl: 'http://example.com/a',
      note: '注'.repeat(501),
      region: 'US' as ReleaseFormValues['region'],
    };
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const fields = codes(locale, invalid);
      expect(fields.title).toBe(locale === 'zh-CN' ? '标题不能为空' : 'Enter a title.');
      expect(fields.releaseDate).toBe(
        locale === 'zh-CN' ? '日期必须是有效的 YYYY-MM-DD' : 'Enter a valid date as YYYY-MM-DD.',
      );
      expect(fields.sourceUrl).toBe(
        locale === 'zh-CN'
          ? '来源链接必须以 https:// 开头'
          : 'Start the source link with https://.',
      );
      expect(fields.note).toBe(
        locale === 'zh-CN' ? '备注最多 500 个字符' : 'Use at most 500 characters for the note.',
      );
      expect(fields.region).toBe(
        locale === 'zh-CN'
          ? '地区只能选中国大陆、日本或全球'
          : 'Choose China mainland, Japan, or Global.',
      );
      expect(Object.values(fields).join(' ')).not.toMatch(
        /source_url|invalid_date|release_region|release_note_too_long/,
      );
    }
    expect(codes('zh-CN', { ...empty, title: '题'.repeat(121) }).title).toBe('标题最多 120 个字符');
    expect(codes('en-US', { ...empty, title: '题'.repeat(121) }).title).toBe(
      'Use at most 120 characters for the title.',
    );
  });

  it('maps a server field error and the terminal sentences without the raw code', () => {
    const region = releaseWriteFeedback('en-US', {
      message: '填写的内容不符合要求，请修改后再试',
      data: {
        code: 'BAD_REQUEST',
        appCode: 'VALIDATION',
        zodError: { fieldErrors: { region: ['release_region'] } },
      },
    });
    expect(region.fields.region).toBe('Choose China mainland, Japan, or Global.');
    expect(region.message).toBeNull();

    const limited = releaseWriteFeedback('zh-CN', {
      message: 'TOO_MANY_REQUESTS',
      data: { code: 'TOO_MANY_REQUESTS', appCode: 'TOO_MANY_REQUESTS' },
    });
    expect(limited.fields).toEqual({});
    expect(limited.message).toBe('操作太频繁，请稍后再试');
    expect(limited.message).not.toContain('TOO_MANY_REQUESTS');

    const missingSeries = releaseWriteFeedback('en-US', {
      message: '系列不存在',
      data: { code: 'NOT_FOUND', appCode: 'NOT_FOUND' },
    });
    expect(missingSeries.fields.seriesId).toBe("That series doesn't exist.");
    expect(missingSeries.gone).toBe(false);
  });
});
