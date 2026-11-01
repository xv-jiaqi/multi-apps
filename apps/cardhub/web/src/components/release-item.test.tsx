import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { rootStore } from '../stores/root-store';
import { ReleaseItem } from './release-item';
import type { ReleaseListItem } from '../lib/releases-list';

function renderItem(item: ReleaseListItem, titleLevel: 'h3' | 'h4' = 'h3') {
  return render(
    <MemoryRouter>
      <ReleaseItem item={item} titleLevel={titleLevel} showDate />
    </MemoryRouter>,
  );
}

const seriesItem: ReleaseListItem = {
  id: 'r1',
  title: '春季补充包',
  releaseDate: '2026-11-06',
  region: 'JP',
  note: '**不要渲染 markdown**',
  sourceUrl: 'https://example.invalid/src',
  series: { slug: 'celestial-dawn', title: '天穹黎明', coverUrl: null },
  category: { slug: 'deck-builder', name: '构筑对战' },
};

describe('ReleaseItem', () => {
  it('keeps the source link outside the series link and shows the date first', () => {
    rootStore.locale.setLocale('zh-CN');
    renderItem(seriesItem);

    const seriesLink = screen.getByRole('link', { name: '春季补充包' });
    const source = screen.getByRole('link', { name: /来源/ });
    expect(seriesLink).toHaveAttribute('href', '/series/celestial-dawn');
    expect(seriesLink).not.toContainElement(source);
    expect(source).toHaveAttribute('href', 'https://example.invalid/src');
    expect(source).toHaveAttribute('target', '_blank');
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('（新窗口打开）')).toHaveClass('sr-only');
    const meta = document.querySelector('time')?.closest('p');
    expect(meta?.querySelector('time')).toHaveAttribute('dateTime', '2026-11-06');
    expect(meta).toHaveTextContent('日本');
    expect(meta).toHaveClass('tabular-nums');
    expect(screen.getByText('**不要渲染 markdown**').tagName).toBe('P');
    expect(screen.getByRole('heading', { level: 3, name: '春季补充包' })).toBeInTheDocument();
  });

  it('renders a text-only card when the release has no series', () => {
    rootStore.locale.setLocale('en-US');
    renderItem(
      {
        ...seriesItem,
        series: null,
        region: null,
        category: null,
        sourceUrl: 'http://example.invalid/insecure',
        note: null,
      },
      'h4',
    );

    expect(screen.getByRole('heading', { level: 4, name: '春季补充包' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '春季补充包' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Source/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('http://example.invalid/insecure');
  });
});
