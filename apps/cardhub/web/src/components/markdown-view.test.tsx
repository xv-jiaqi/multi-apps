import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
