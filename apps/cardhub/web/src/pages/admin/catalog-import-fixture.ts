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

/** 64-character slugs used to check wrap-anywhere in CH-238 §10-3. */
export const CH238_LONG_SLUG = 'a-very-long-card-slug-used-to-check-wrapping-at-the-sixty-four-x';
export const CH238_LONG_SUBSET = 'a-very-long-subset-slug-that-hits-the-sixty-four-character-limit';
/** 21 characters, over CARD_NUMBER_MAX (20). Shown in full, not truncated. */
export const CH238_LONG_CARD_NUMBER = 'SV-PROMO-0001-2026-CN';

/** File values that produce CH238_ROWS in a dry-run preview (UI does not reread these keys). */
export const CH238_IMPORT = [
  {
    slug: 'ptcg-sc-30th',
    title: '30周年庆典',
    categorySlug: 'ptcg-sc',
    releaseDate: '2026-09-16',
    cards: [
      {
        slug: 'ptcg-sc-30th-001',
        name: '蛋蛋',
        rarity: 'common',
        subsetSlug: 'main',
        cardNumber: '001',
      },
    ],
  },
  { slug: 'demo-omit', title: '省略示例', categorySlug: 'ptcg-sc' },
  {
    slug: 'demo-clear',
    title: '清空示例',
    cards: [
      {
        slug: 'demo-clear-card',
        name: '清空示例',
        rarity: 'common',
        subsetSlug: 'main',
        cardNumber: '',
      },
      {
        slug: CH238_LONG_SLUG,
        name: '长值示例',
        rarity: 'common',
        subsetSlug: CH238_LONG_SUBSET,
        cardNumber: CH238_LONG_CARD_NUMBER,
      },
    ],
  },
];

/** Preview rows for CH-238 §10-1–§10-3: values, omitted, will-clear, invalid long card number. */
export const CH238_ROWS: ImportRowResult[] = [
  {
    row: {
      row: 1,
      type: 'series',
      slug: 'ptcg-sc-30th',
      name: '30周年庆典',
      categorySlug: 'ptcg-sc',
      releaseDate: '2026-09-16',
    },
    status: 'updated',
    errors: [],
  },
  {
    row: {
      row: 2,
      type: 'card',
      slug: 'ptcg-sc-30th-001',
      name: '蛋蛋',
      seriesSlug: 'ptcg-sc-30th',
      subsetSlug: 'main',
      cardNumber: '001',
    },
    status: 'unchanged',
    errors: [],
  },
  {
    row: {
      row: 3,
      type: 'series',
      slug: 'demo-omit',
      name: '省略示例',
      categorySlug: 'ptcg-sc',
    },
    status: 'updated',
    errors: [],
  },
  {
    row: {
      row: 4,
      type: 'card',
      slug: 'demo-clear-card',
      name: '清空示例',
      seriesSlug: 'demo-clear',
      subsetSlug: 'main',
      cardNumber: '',
    },
    status: 'updated',
    errors: [],
  },
  {
    row: {
      row: 5,
      type: 'card',
      slug: CH238_LONG_SLUG,
      name: '长值示例',
      seriesSlug: 'demo-clear',
      subsetSlug: CH238_LONG_SUBSET,
      cardNumber: CH238_LONG_CARD_NUMBER,
    },
    status: 'error',
    errors: [{ path: 'series[2].cards[1].cardNumber', code: 'TOO_LONG' }],
  },
];
