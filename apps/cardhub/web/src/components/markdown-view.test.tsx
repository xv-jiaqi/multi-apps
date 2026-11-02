import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { rootStore } from '../stores/root-store';
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
    const mentions = [...container.querySelectorAll('[class~="text-brand-700"]')].map(
      (node) => node.textContent,
    );
    expect(mentions).toEqual(['@Ada']);
    expect(container.querySelector('code')?.textContent).toContain('@Ada');
    expect(container.querySelector('a')?.textContent).toBe('@Ada');
    expect(container.querySelector('a [class~="text-brand-700"]')).toBeNull();
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
