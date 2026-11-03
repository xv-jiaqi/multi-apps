import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

vi.mock('../components/page-shell', () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('../components/page-meta', () => ({ PageMeta: () => null }));

import { NotFoundPage } from './not-found';

describe('NotFoundPage (CH-114 §6)', () => {
  it.each([
    ['zh-CN', '内容不存在'],
    ['en-US', 'Not found'],
  ] as const)('%s: hides the decorative 404, keeps the h1 and the home link', (locale, title) => {
    rootStore.locale.setLocale(locale);
    const { container } = render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    const digits = screen.getByText('404', { ignore: false });
    expect(digits.tagName).toBe('P');
    expect(digits).toHaveAttribute('aria-hidden', 'true');
    // CH-114 §6-1 v6.1 + CH-305 v1.2 §10-1: text-muted #666666 on #f6f6f6 is 5.31:1
    expect(digits).toHaveClass('text-muted');
    expect(digits).not.toHaveClass('text-neutral-300');
    expect(
      screen.queryByText('404', { ignore: '[aria-hidden="true"], [aria-hidden="true"] *' }),
    ).toBeNull();
    expect(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    const home = screen.getByRole('link');
    expect(home).toHaveAttribute('href', '/');
    // reading order: h1 comes before the link and nothing announces "404"
    expect(container.querySelector('main')!.textContent).toBe(`404${title}${home.textContent}`);
  });
});
