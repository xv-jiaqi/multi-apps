import { describe, expect, it } from 'vitest';
import { t } from './i18n';
import {
  CATALOG_IMPORT_MAX_BYTES,
  CATALOG_IMPORT_MAX_ROWS,
  catalogImportLimit,
  countCatalogImportRows,
  utf8ByteLength,
} from './catalog-import';

describe('catalog import limits', () => {
  it('counts series rows and nested card rows', () => {
    expect(countCatalogImportRows(null)).toBe(0);
    expect(countCatalogImportRows([{ slug: 'only-series' }])).toBe(1);
    expect(
      countCatalogImportRows([
        { slug: 'with-cards', cards: [{ slug: 'a' }, { slug: 'b' }] },
        { slug: 'bad-cards', cards: 'nope' },
      ]),
    ).toBe(4);
  });

  it('measures utf-8 bytes for ascii, cjk, and emoji', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('中')).toBe(3);
    expect(utf8ByteLength('🙂')).toBe(4);
  });

  it('rejects 501 rows and payloads over 1MB, and allows exactly 500 rows', () => {
    const cards = (count: number) => Array.from({ length: count }, (_, index) => ({ slug: index }));
    expect(catalogImportLimit({ dryRun: true, data: [{ slug: 's', cards: cards(500) }] })).toEqual({
      reason: 'tooManyRows',
      count: 501,
    });
    expect(
      catalogImportLimit({ dryRun: true, data: [{ slug: 's', cards: cards(499) }] }),
    ).toBeNull();
    expect(catalogImportLimit({ dryRun: true, data: cards(CATALOG_IMPORT_MAX_ROWS) })).toBeNull();

    const oversized = {
      dryRun: false,
      data: [{ slug: 's', blob: 'x'.repeat(CATALOG_IMPORT_MAX_BYTES) }],
    };
    expect(utf8ByteLength(JSON.stringify(oversized))).toBeGreaterThan(CATALOG_IMPORT_MAX_BYTES);
    expect(catalogImportLimit(oversized)).toEqual({ reason: 'tooLarge' });
  });

  it('shares the rejection copy in zh and en', () => {
    expect(t('zh-CN', 'admin.import.tooManyRows', { count: 501 })).toBe(
      '一次最多导入 500 行，当前 501 行',
    );
    expect(t('zh-CN', 'admin.import.tooLarge')).toBe('一次最多导入 1MB');
    expect(t('zh-CN', 'error.payloadTooLarge')).toBe('内容太大，请精简后重试');
    expect(t('en-US', 'admin.import.tooManyRows', { count: 501 })).toContain('500');
    expect(t('en-US', 'admin.import.tooLarge')).toContain('1MB');
    expect(t('en-US', 'error.payloadTooLarge')).toBe(
      'This content is too large. Shorten it and try again.',
    );
  });
});
