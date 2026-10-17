import { describe, expect, it } from 'vitest';
import { markdownToPlainText } from './index';

describe('markdownToPlainText', () => {
  it('removes code blocks, images, html tags, and table separators', () => {
    const markdown = [
      '# Title',
      '```ts',
      'const secret = true;',
      '```',
      '![alt text](https://example.com/image.png)',
      '<div>hidden</div>',
      '| --- | :---: |',
      'Visible text',
    ].join('\n');

    expect(markdownToPlainText(markdown, 120)).toBe('Title Visible text');
  });

  it('keeps useful inline text while stripping markdown punctuation', () => {
    const markdown =
      '> **Bold** and _em_ with [docs](https://example.com), <https://example.com>, `code`, - [x] task';

    expect(markdownToPlainText(markdown, 120)).toBe(
      'Bold and em with docs, https://example.com, code, task',
    );
  });

  it('collapses mixed Chinese and English whitespace', () => {
    expect(markdownToPlainText('中文   text\n\n第二行', 120)).toBe('中文 text 第二行');
  });

  it('truncates by code point without splitting emoji', () => {
    expect(markdownToPlainText('A😀BC', 3)).toBe('A😀B…');
  });

  it('returns an empty string when only non-summary content remains', () => {
    expect(markdownToPlainText('```txt\nonly code\n```\n![alt](url)', 120)).toBe('');
  });

  it('handles long urls without dropping them', () => {
    const url = 'https://example.com/' + 'a'.repeat(80);

    expect(markdownToPlainText(`<${url}>`, 120)).toBe(url);
  });

  it('preserves underscores and asterisks inside ordinary text and urls', () => {
    const url = 'https://example.com/a_b';

    expect(markdownToPlainText(`Use snake_case, ${url}, and 5 * 3.`, 120)).toBe(
      `Use snake_case, ${url}, and 5 * 3.`,
    );
  });

  it('handles malicious unclosed tags and links quickly after truncating input', () => {
    const malicious = `${'[link]('.repeat(2500)} ${'<article '.repeat(2500)}safe text`;
    const startedAt = Date.now();

    const result = markdownToPlainText(malicious, 120);

    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(Array.from(result).length).toBeLessThanOrEqual(121);
  });
});
