import { describe, expect, it } from 'vitest';
import { markdownToPlainText } from '@repo/shared';
import { stripMarkdownKeepNewlines } from './plain-text';

describe('stripMarkdownKeepNewlines (CH-301 §2)', () => {
  it('strips markers but keeps newlines, unlike markdownToPlainText', () => {
    const source = '中文   text\n\n第二行';
    expect(markdownToPlainText(source, 120)).toBe('中文 text 第二行');
    expect(stripMarkdownKeepNewlines(source)).toBe('中文 text\n\n第二行');
  });

  it('drops fences, headings, emphasis and links', () => {
    const source = [
      '# 标题',
      '',
      '这是 **粗体** 和 *斜体*，还有 [链接](https://example.com)。',
      '',
      '```',
      'secret()',
      '```',
      '',
      '- 一项',
      '- 二项',
    ].join('\n');
    expect(stripMarkdownKeepNewlines(source)).toBe(
      '标题\n\n这是 粗体 和 斜体，还有 链接。\n\n一项\n二项',
    );
  });

  it('returns empty string for only-markup input', () => {
    expect(stripMarkdownKeepNewlines('```\ncode\n```')).toBe('');
  });
});
