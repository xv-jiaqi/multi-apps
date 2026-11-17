import type { ImportRowResult } from '../../components/admin/catalog-utils';

/** CH-107 §7.8: the AC6-2 file, five bad rows plus two good rows. */
export const AC62_IMPORT = [
  { slug: 'bad-category', title: '品类不存在', categorySlug: 'no-such-category' },
  { slug: 'bad-date', title: '日期不存在', releaseDate: '2026-13-01' },
  {
    slug: 'good-series',
    title: '正常系列',
    subsets: [{ slug: 'base', name: '基础卡', kind: 'BASE', sortOrder: 0 }],
    cards: [
      { slug: 'bad-subset', name: '子集不存在', rarity: 'common', subsetSlug: 'nowhere' },
      {
        slug: 'bad-number',
        name: '卡号太长',
        rarity: 'common',
        cardNumber: '123456789012345678901',
      },
      { slug: 'bad-field', name: '字段写错', rarity: 'common', cardNo: '001' },
      {
        slug: 'good-card',
        name: '正常卡',
        rarity: 'common',
        cardNumber: '001',
        subsetSlug: 'base',
      },
    ],
  },
];

/** What `admin.catalog.import` (#273) returns for `AC62_IMPORT` with `dryRun: true`. */
export const AC62_ROWS: ImportRowResult[] = [
  {
    row: { row: 1, type: 'series', slug: 'bad-category', name: '品类不存在' },
    status: 'error',
    errors: [{ path: 'series[0].categorySlug', code: 'CATEGORY_NOT_FOUND' }],
  },
  {
    row: { row: 2, type: 'series', slug: 'bad-date', name: '日期不存在' },
    status: 'error',
    errors: [{ path: 'series[1].releaseDate', code: 'INVALID_DATE' }],
  },
  {
    row: { row: 3, type: 'series', slug: 'good-series', name: '正常系列' },
    status: 'created',
    errors: [],
  },
  {
    row: {
      row: 4,
      type: 'card',
      slug: 'bad-subset',
      name: '子集不存在',
      seriesSlug: 'good-series',
    },
    status: 'error',
    errors: [{ path: 'series[2].cards[0].subsetSlug', code: 'SUBSET_NOT_FOUND' }],
  },
  {
    row: { row: 5, type: 'card', slug: 'bad-number', name: '卡号太长', seriesSlug: 'good-series' },
    status: 'error',
    errors: [{ path: 'series[2].cards[1].cardNumber', code: 'TOO_LONG' }],
  },
  {
    row: { row: 6, type: 'card', slug: 'bad-field', name: '字段写错', seriesSlug: 'good-series' },
    status: 'error',
    errors: [{ path: 'series[2].cards[2].cardNo', code: 'UNKNOWN_FIELD' }],
  },
  {
    row: { row: 7, type: 'card', slug: 'good-card', name: '正常卡', seriesSlug: 'good-series' },
    status: 'created',
    errors: [],
  },
];

/** CH-107 §7.8 (AC7-3): a normal series, then a new series listing 21 subsets. */
export const AC73_IMPORT = [
  { slug: 'neighbour', title: '正常系列' },
  {
    slug: 'subsets-21',
    title: '二十一个子集',
    subsets: Array.from({ length: 21 }, (_, index) => ({
      slug: `s-${index + 1}`,
      name: `子集 ${index + 1}`,
      kind: index === 0 ? 'BASE' : 'INSERT',
      sortOrder: index,
    })),
  },
];

/** What `admin.catalog.import` (#279) returns for `AC73_IMPORT` with `dryRun: true`. */
export const AC73_ROWS: ImportRowResult[] = [
  {
    row: { row: 1, type: 'series', slug: 'neighbour', name: '正常系列' },
    status: 'created',
    errors: [],
  },
  {
    row: { row: 2, type: 'series', slug: 'subsets-21', name: '二十一个子集' },
    status: 'error',
    errors: [{ path: 'series[1].subsets', code: 'TOO_MANY_SUBSETS' }],
  },
];
