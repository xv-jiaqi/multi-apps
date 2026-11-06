import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { rootStore } from '../stores/root-store';
import { MarkdownView } from './markdown-view';

// CH-220 v1.4 §2-4 / 20-9 sample: a table before any heading, then one under
// `## 价格` and one under `### 版本对照`.
const multiTableBody = [
  '| a |',
  '| --- |',
  '| 1 |',
  '',
  '## 价格',
  '',
  '| b |',
  '| --- |',
  '| 2 |',
  '',
  '### 版本对照',
  '',
  '| c |',
  '| --- |',
  '| 3 |',
].join('\n');

const singleBody = '## 价格\n\n| a |\n| --- |\n| 1 |';

const expected = {
  'zh-CN': ['表格 1（可横向滚动）', '价格：表格 2（可横向滚动）', '版本对照：表格 3（可横向滚动）'],
  'en-US': ['Table 1 (scrollable)', '价格: Table 2 (scrollable)', '版本对照: Table 3 (scrollable)'],
} as const;
const single = { 'zh-CN': '表格（可横向滚动）', 'en-US': 'Table (scrollable)' } as const;

afterEach(() => {
  act(() => rootStore.locale.setLocale('zh-CN'));
});

describe.each(['card', 'forum'] as const)('MarkdownTable naming (%s)', (variant) => {
  describe.each(['zh-CN', 'en-US'] as const)('%s', (locale) => {
    it('numbers multiple tables in document order with the nearest heading', () => {
      act(() => rootStore.locale.setLocale(locale));
      const { container } = render(<MarkdownView body={multiTableBody} variant={variant} />);
      const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
      expect(names).toEqual(expected[locale]);
      expect(new Set(names).size).toBe(3);
      for (const r of screen.getAllByRole('region'))
        expect(r).not.toHaveAttribute('aria-labelledby');
      expect(container.querySelector('h1,h2,h3,h4,h5,h6')?.id ?? '').toBe('');
      for (const table of container.querySelectorAll('table')) {
        expect(
          [...table.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')),
        ).toEqual([]);
      }
    });

    it('keeps the plain name for a single table', () => {
      act(() => rootStore.locale.setLocale(locale));
      render(<MarkdownView body={singleBody} variant={variant} />);
      expect(screen.getByRole('region')).toHaveAttribute('aria-label', single[locale]);
    });
  });
});

describe('MarkdownTable heading text', () => {
  it('collapses whitespace and includes mention text (forum)', () => {
    render(
      <MarkdownView
        body={'## 价格  @ada   表\n\n| a |\n| --- |\n| 1 |\n\n| b |\n| --- |\n| 2 |'}
      />,
    );
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual([
      '价格 @ada 表：表格 1（可横向滚动）',
      '价格 @ada 表：表格 2（可横向滚动）',
    ]);
  });
});

// CH-220 v1.4 §2-4 / 20-9 with CH-221 §2-2: forum `#` renders as h2, but the
// naming plugin reads the source heading, so both tables still get `价格`.
describe.each(['zh-CN', 'en-US'] as const)('MarkdownTable naming under forum # (%s)', (locale) => {
  it('names both tables after the demoted `# 价格` heading', () => {
    act(() => rootStore.locale.setLocale(locale));
    const { container } = render(
      <MarkdownView
        variant="forum"
        body={'# 价格\n\n| a |\n| --- |\n| 1 |\n\n| b |\n| --- |\n| 2 |'}
      />,
    );
    expect(container.querySelector('h1')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: '价格' })).toBeInTheDocument();
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(
      locale === 'zh-CN'
        ? ['价格：表格 1（可横向滚动）', '价格：表格 2（可横向滚动）']
        : ['价格: Table 1 (scrollable)', '价格: Table 2 (scrollable)'],
    );
  });
});

// CH-220 v1.5 §2-4 / 20-9: {heading} is the heading's accessible name — text
// and image alt joined in order, trimmed. Empty means "no heading" and does
// not fall back to an earlier heading.
const imgTwoTables = (heading: string) =>
  `${heading}\n\n| a |\n| --- |\n| 1 |\n\n| b |\n| --- |\n| 2 |`;
const zhEn = (locale: 'zh-CN' | 'en-US', h: string | null, n: number) =>
  locale === 'zh-CN'
    ? h
      ? `${h}：表格 ${n}（可横向滚动）`
      : `表格 ${n}（可横向滚动）`
    : h
      ? `${h}: Table ${n} (scrollable)`
      : `Table ${n} (scrollable)`;

describe.each(['card', 'forum'] as const)(
  'MarkdownTable naming, image headings (%s)',
  (variant) => {
    describe.each(['zh-CN', 'en-US'] as const)('%s', (locale) => {
      const names = (body: string) => {
        act(() => rootStore.locale.setLocale(locale));
        render(<MarkdownView body={body} variant={variant} />);
        return screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
      };

      it('uses the image alt for an image-only heading', () => {
        expect(names(imgTwoTables('## ![价格图](x.png)'))).toEqual([
          zhEn(locale, '价格图', 1),
          zhEn(locale, '价格图', 2),
        ]);
      });

      it('treats an empty-alt image heading as no heading', () => {
        expect(names(imgTwoTables('## ![](x.png)'))).toEqual([
          zhEn(locale, null, 1),
          zhEn(locale, null, 2),
        ]);
      });

      it('joins text and alt in document order', () => {
        expect(names(imgTwoTables('##  价格 ![走势图](x.png) 对照 '))).toEqual([
          zhEn(locale, '价格 走势图 对照', 1),
          zhEn(locale, '价格 走势图 对照', 2),
        ]);
      });

      it('does not fall back to an earlier heading past an empty-alt heading', () => {
        expect(
          names('## 价格\n\n| a |\n| --- |\n| 1 |\n\n## ![](x.png)\n\n| b |\n| --- |\n| 2 |'),
        ).toEqual([zhEn(locale, '价格', 1), zhEn(locale, null, 2)]);
      });
    });
  },
);

// CH-220 v1.9 §2-5 / 20-11: tableRegionPrefix is prepended; without it names stay §2-4.
describe.each(['zh-CN', 'en-US'] as const)('MarkdownTable tableRegionPrefix (%s)', (locale) => {
  const prefix = locale === 'zh-CN' ? '回复 1：' : 'Reply 1: ';

  it('prepends the prefix to every §2-4 label', () => {
    act(() => rootStore.locale.setLocale(locale));
    render(<MarkdownView body={multiTableBody} tableRegionPrefix={prefix} />);
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(expected[locale].map((n) => `${prefix}${n}`));
    expect(new Set(names).size).toBe(3);
  });

  it('leaves names unchanged when the prefix is omitted', () => {
    act(() => rootStore.locale.setLocale(locale));
    render(<MarkdownView body={multiTableBody} />);
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(expected[locale]);
  });

  it('prepends the prefix to a single-table label', () => {
    act(() => rootStore.locale.setLocale(locale));
    render(<MarkdownView body={singleBody} tableRegionPrefix={prefix} />);
    expect(screen.getByRole('region')).toHaveAttribute('aria-label', `${prefix}${single[locale]}`);
  });
});
