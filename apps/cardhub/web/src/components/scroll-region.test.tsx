import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScrollRegion } from '@repo/ui-web';
import { rootStore } from '../stores/root-store';
import { AdminTable } from './admin/admin-table';
import { MarkdownView } from './markdown-view';

// CH-220 §2 / 20-1, 20-7.
describe('ScrollRegion', () => {
  it('is a focusable region named by the visible heading', () => {
    render(
      <>
        <h1 id="page-title">操作审计</h1>
        <ScrollRegion labelledBy="page-title">
          <table />
        </ScrollRegion>
      </>,
    );
    const region = screen.getByRole('region', { name: '操作审计' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveAttribute('aria-labelledby', 'page-title');
    expect(region).not.toHaveAttribute('aria-label');
    expect(region).toHaveClass(
      'overflow-x-auto',
      'focus-visible:ring-2',
      'focus-visible:ring-brand-500',
      'focus-visible:ring-offset-2',
    );
  });

  it('falls back to aria-label only when there is no heading', () => {
    render(<ScrollRegion label="表格（可横向滚动）" />);
    const region = screen.getByRole('region', { name: '表格（可横向滚动）' });
    expect(region).not.toHaveAttribute('aria-labelledby');
  });

  it('uses an inset ring when the ancestor would clip it', () => {
    render(<ScrollRegion label="x" inset />);
    expect(screen.getByRole('region')).toHaveClass(
      'focus-visible:ring-inset',
      'focus-visible:ring-offset-0',
    );
  });
});

describe('AdminTable', () => {
  it('scrolls inside a region named by the page h1, keeping the sr-only caption', () => {
    render(
      <>
        <h1 id="h">Audit log</h1>
        <AdminTable caption="Audit entries" labelledBy="h">
          <tbody />
        </AdminTable>
      </>,
    );
    const region = screen.getByRole('region', { name: 'Audit log' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('table', { name: 'Audit entries' })).toBeInTheDocument();
  });

  it('keeps a standalone skeleton contained: no region, no tab stop (20-7)', () => {
    const { container } = render(
      <AdminTable caption="Loading" busy contained>
        <tbody />
      </AdminTable>,
    );
    expect(screen.queryByRole('region')).toBeNull();
    const frame = container.firstElementChild!;
    expect(frame).not.toHaveAttribute('tabindex');
    expect(frame).not.toHaveClass('overflow-x-auto');
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('stays the same region while busy with inline skeleton rows (20-8)', () => {
    const { rerender } = render(
      <>
        <h1 id="h">Users</h1>
        <AdminTable caption="c" labelledBy="h" busy>
          <tbody />
        </AdminTable>
      </>,
    );
    const before = screen.getByRole('region', { name: 'Users' });
    rerender(
      <>
        <h1 id="h">Users</h1>
        <AdminTable caption="c" labelledBy="h">
          <tbody />
        </AdminTable>
      </>,
    );
    const after = screen.getByRole('region', { name: 'Users' });
    expect(after).toBe(before);
    expect(after).toHaveAttribute('tabindex', '0');
  });
});

describe('MarkdownTable', () => {
  afterEach(() => rootStore.locale.setLocale('zh-CN'));

  it.each([
    ['zh-CN', '表格（可横向滚动）'],
    ['en-US', 'Table (scrollable)'],
  ] as const)('falls back to a11y.scrollTable in %s', (locale, name) => {
    rootStore.locale.setLocale(locale);
    render(<MarkdownView body={'| col |\n| --- |\n| cell |'} variant="card" />);
    const region = screen.getByRole('region', { name });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.querySelector('table')).not.toBeNull();
  });
});
