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
