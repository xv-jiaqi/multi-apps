import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { rootStore } from '../stores/root-store';
import { SAMPLE_F, expectSampleFDom } from '../../test/ch223-sample';
import { MarkdownView } from './markdown-view';

const body = [
  'https://example.com/' + 'a'.repeat(40),
  '',
  '`inline`',
  '',
  '```',
  'const value = 1;',
  '```',
  '',
  '| col |',
  '| --- |',
  '| cell |',
].join('\n');

describe('MarkdownView', () => {
  it('wraps user content and keeps code blocks and tables in their own scroll frames', () => {
    const { container } = render(<MarkdownView body={body} />);
    const root = container.firstElementChild;

    expect(root).toHaveClass('min-w-0', 'wrap-anywhere');
    expect(root).not.toHaveClass('break-words');
    expect(root?.className).not.toContain('[overflow-wrap:');

    const pre = container.querySelector('pre');
    expect(pre).toHaveClass('overflow-x-auto', 'max-w-full', 'whitespace-pre');

    const table = container.querySelector('table');
    expect(table?.parentElement).toHaveClass('max-w-full', 'overflow-x-auto');
    expect(table?.parentElement?.tagName).toBe('DIV');
  });

  it('styles an @name in prose and leaves code and link text alone', () => {
    const { container } = render(
      <MarkdownView
        body={[
          'Hello @Ada.',
          '',
          '`@Ada`',
          '',
          '```',
          '@Ada',
          '```',
          '',
          '[@Ada](https://example.com)',
        ].join('\n')}
      />,
    );
    const mentions = [...container.querySelectorAll('[class~="text-link-strong"]')].map(
      (node) => node.textContent,
    );
    expect(mentions).toEqual(['@Ada']);
    expect(container.querySelector('code')?.textContent).toContain('@Ada');
    expect(container.querySelector('a')?.textContent).toBe('@Ada');
    expect(container.querySelector('a [class~="text-link-strong"]')).toBeNull();
  });
  it.each(['forum', 'card'] as const)(
    'lets keyboard users focus a scrollable code block (%s, WCAG 2.1.1)',
    async (variant) => {
      const user = userEvent.setup();
      const { container } = render(<MarkdownView body={body} variant={variant} />);
      const pre = container.querySelector('pre');
      expect(pre).toHaveAttribute('tabindex', '0');
      await user.tab(); // autolink
      await user.tab();
      expect(pre).toHaveFocus();
      expect(pre).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-brand-500');
    },
  );
  it('names the code block as a region in the current locale (CH-206 §2)', () => {
    rootStore.locale.setLocale('zh-CN');
    render(<MarkdownView body={body} variant="card" />);
    expect(screen.getByRole('region', { name: '代码块' }).tagName).toBe('PRE');
    act(() => rootStore.locale.setLocale('en-US'));
    expect(screen.getByRole('region', { name: 'Code block' }).tagName).toBe('PRE');
    act(() => rootStore.locale.setLocale('zh-CN'));
  });
});

describe('MarkdownView forum variant source h1 (CH-221 21-6)', () => {
  it('renders # as h2 and leaves ## / ### alone', () => {
    const { container } = render(<MarkdownView body={'# x\n\n## y\n\n### z'} />);
    expect(container.querySelector('h1')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'x' })).not.toHaveAttribute('class');
    expect(screen.getByRole('heading', { level: 2, name: 'y' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'z' })).toBeInTheDocument();
  });

  it('keeps the card variant mapping (# -> h3)', () => {
    render(<MarkdownView variant="card" body={'# x'} />);
    expect(screen.getByRole('heading', { level: 3, name: 'x' })).toBeInTheDocument();
  });
});

// CH-222 §2-1 / §4 sample S.
const sampleS = [
  '# 一级',
  '## 价格',
  '### 细则',
  '#### 备注',
  '##### 五级',
  '###### 六级',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
].join('\n');

describe('MarkdownView card variant heading levels (CH-222)', () => {
  it('starts source ## at h3 and caps at h6 (22-1)', () => {
    const { container } = render(<MarkdownView variant="card" body={sampleS} />);
    const headings = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    expect(headings.map((h) => [h.tagName, h.textContent])).toEqual([
      ['H3', '一级'],
      ['H3', '价格'],
      ['H4', '细则'],
      ['H5', '备注'],
      ['H6', '五级'],
      ['H6', '六级'],
    ]);
    expect(container.querySelector('h1, h2')).toBeNull();
  });

  it('keeps each source level class unchanged (22-3)', () => {
    const { container } = render(<MarkdownView variant="card" body={sampleS} />);
    const classes = [...container.querySelectorAll('h3, h4, h5, h6')].map((h) => h.className);
    expect(classes).toEqual([
      'mt-6 text-lg font-semibold text-neutral-900',
      'mt-5 text-base font-semibold text-neutral-900',
      'mt-4 text-base font-medium text-neutral-900',
      'mt-4 text-sm font-medium text-neutral-900',
      'mt-4 text-sm font-medium text-neutral-900',
      'mt-4 text-sm font-medium text-neutral-900',
    ]);
  });
});

// CH-222 v1.1 §2-7 / 22-12 sample S2.
const sampleS2 = [
  '## ![价格图](x.png)',
  '| a | b |\n| --- | --- |\n| 1 | 2 |',
  '## 文字 ![图](x.png) 尾',
  '| a | b |\n| --- | --- |\n| 1 | 2 |',
  '## ![价格图](https://img.invalid/x.png)',
  '| a | b |\n| --- | --- |\n| 1 | 2 |',
  '## ![](x.png)',
  '| a | b |\n| --- | --- |\n| 1 | 2 |',
].join('\n\n');

describe('MarkdownView card variant images in headings (CH-222 §2-7)', () => {
  it('shows a non-https image as its alt text inside the heading (22-13)', () => {
    const { container } = render(<MarkdownView variant="card" body={sampleS2} />);
    const h3s = [...container.querySelectorAll('h3')];
    expect(h3s).toHaveLength(4);
    const [onlyImg, mixed, https, emptyAlt] = [h3s[0]!, h3s[1]!, h3s[2]!, h3s[3]!];
    expect(onlyImg.innerHTML).toBe('<span>价格图</span>');
    expect([...mixed.childNodes].map((n) => [n.nodeName, n.textContent])).toEqual([
      ['#text', '文字 '],
      ['SPAN', '图'],
      ['#text', ' 尾'],
    ]);
    const img = https.querySelector('img')!;
    expect(https.children).toHaveLength(1);
    expect(img).toHaveAttribute('alt', '价格图');
    expect(img).toHaveAttribute('src', 'https://img.invalid/x.png');
    expect(img).toHaveClass('h-auto max-w-full rounded-lg', { exact: true });
    expect(emptyAlt.querySelector('span, img')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('names each heading like the table region after it (22-14)', () => {
    render(<MarkdownView variant="card" body={sampleS2} />);
    for (const name of ['价格图', '文字 图 尾']) {
      expect(screen.getAllByRole('heading', { level: 3, name })[0]).toBeInTheDocument();
    }
    expect(screen.getAllByRole('heading', { level: 3, name: '价格图' })).toHaveLength(2);
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions.slice(0, 3).map((r) => r?.split('：')[0])).toEqual([
      '价格图',
      '文字 图 尾',
      '价格图',
    ]);
  });

  it('joins two adjacent image alts with no space (§2-7④: 甲乙)', () => {
    const body = [
      '## ![甲](x.png)![乙](x.png)',
      '',
      '| a |',
      '| --- |',
      '| 1 |',
      '',
      '## 后',
      '',
      '| b |',
      '| --- |',
      '| 2 |',
    ].join('\n');
    const { container } = render(<MarkdownView variant="card" body={body} />);
    expect(container.querySelector('h3')!.innerHTML).toBe('<span>甲</span><span>乙</span>');
    expect(screen.getByRole('heading', { level: 3, name: '甲乙' })).toBeInTheDocument();
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions.map((r) => r?.split('：')[0])).toEqual(['甲乙', '后']);
  });

  it('still drops a non-https image outside headings (CH-206)', () => {
    const { container } = render(<MarkdownView variant="card" body={'![a](x.png) 正文'} />);
    expect(container.querySelector('img, span')).toBeNull();
    expect(container).not.toHaveTextContent(/^a/);
  });
});

describe('MarkdownView forum variant images (CH-223)', () => {
  it('applies the card https rule to forum images, in and out of headings (23-1, 23-2)', () => {
    const { container } = render(<MarkdownView body={SAMPLE_F} />);
    expectSampleFDom(container);
  });

  it('keeps the alt of a rejected image inside a demoted # heading (23-1)', () => {
    const { container } = render(<MarkdownView body={'# ![a](x.png)'} />);
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h2')!.outerHTML).toBe('<h2><span>a</span></h2>');
  });

  it('treats h3–h6 like h2 and leaves them unstyled (§3-2)', () => {
    const { container } = render(
      <MarkdownView
        body={'### ![c](x.png)\n\n#### ![d](x.png)\n\n##### ![e](x.png)\n\n###### ![f](x.png)'}
      />,
    );
    expect([...container.querySelectorAll('h3, h4, h5, h6')].map((h) => h.outerHTML)).toEqual([
      '<h3><span>c</span></h3>',
      '<h4><span>d</span></h4>',
      '<h5><span>e</span></h5>',
      '<h6><span>f</span></h6>',
    ]);
  });

  it('judges src after sanitize, the same way as cards, without trimming (§3-1)', () => {
    const body =
      '![a](HTTPS://img.test/A.png) ![b](<  https://img.test/b.png>) ![c](https://img.test/C.png)';
    for (const variant of ['forum', 'card'] as const) {
      const { container, unmount } = render(<MarkdownView variant={variant} body={body} />);
      const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
      expect(srcs).toEqual(['https://img.test/C.png']);
      unmount();
    }
  });

  it('names forum tables after their heading text (23-4)', () => {
    render(<MarkdownView body={SAMPLE_F} />);
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions).toEqual([
      '价格图：表格 1（可横向滚动）',
      '文字 图 尾：表格 2（可横向滚动）',
      '外链：表格 3（可横向滚动）',
      '表格 4（可横向滚动）',
      'https图：表格 5（可横向滚动）',
    ]);
    for (const name of ['价格图', '文字 图 尾', '外链', 'https图']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
  });
});
