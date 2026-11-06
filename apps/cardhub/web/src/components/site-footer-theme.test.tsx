import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import { SiteFooter } from './site-footer';
import { controlBase } from '@repo/ui-web';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('SiteFooter theme control (CH-305 §4 / 305-4)', () => {
  beforeEach(() => {
    localStorage.clear();
    rootStore.locale.setLocale('zh-CN');
    delete (window as unknown as { __cardhubApplyTheme?: unknown }).__cardhubApplyTheme;
  });

  it('renders the Appearance group with three options and zh copy', () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );
    expect(screen.getByRole('group', { name: '外观' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '跟随系统' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '浅色' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '深色' })).not.toBeChecked();
  });

  it('writes cardhub:theme and calls __cardhubApplyTheme when choosing Dark', async () => {
    const apply = vi.fn();
    (window as unknown as { __cardhubApplyTheme: () => void }).__cardhubApplyTheme = apply;
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('radio', { name: '深色' }));
    expect(localStorage.getItem('cardhub:theme')).toBe('dark');
    expect(apply).toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '深色' })).toBeChecked();
  });

  it('uses English copy from footer.theme.* keys', () => {
    rootStore.locale.setLocale('en-US');
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );
    expect(screen.getByRole('group', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
  });
});

describe('CH-305 §11-3 ring-offset-card and dark: patches', () => {
  it('controlBase includes focus-visible:ring-offset-card (赵茬 / 9 处)', () => {
    expect(controlBase).toContain('focus-visible:ring-offset-card');
    expect(controlBase).toContain('focus-visible:ring-brand-500');
    expect(controlBase).toContain('focus-visible:ring-offset-2');
  });

  it('the other 8 form controls that had ring-offset-2 also gained ring-offset-card', () => {
    const files = [
      'packages/ui-web/src/components/confirm-phrase-field.tsx',
      'apps/cardhub/web/src/pages/admin/card-form-page.tsx',
      'apps/cardhub/web/src/pages/admin/catalog-import.tsx',
      'apps/cardhub/web/src/pages/admin/release-form-page.tsx',
      'apps/cardhub/web/src/pages/admin/series-form-page.tsx',
      'apps/cardhub/web/src/pages/trade-publish.tsx',
    ];
    let offset2 = 0;
    let withCard = 0;
    for (const rel of files) {
      const src = readFileSync(path.join(repoRoot, rel), 'utf8');
      const re = /focus-visible:ring-offset-2(?:\s+focus-visible:ring-offset-card)?/g;
      for (const m of src.matchAll(re)) {
        offset2 += 1;
        if (m[0].includes('ring-offset-card')) withCard += 1;
      }
    }
    // 1 confirm + 2 card-form + 1 import + 1 release + 1 series + 2 trade = 8
    expect(offset2).toBe(8);
    expect(withCard).toBe(8);
  });

  it('§B / §11-3 dark: companions are present on the 14 hardcoded status sites', () => {
    const checks: Array<[string, string]> = [
      [
        'apps/cardhub/web/src/pages/reports-list.tsx',
        'bg-amber-100 text-warning dark:bg-warning-soft',
      ],
      [
        'apps/cardhub/web/src/pages/reports-list.tsx',
        'bg-emerald-100 text-success dark:bg-success-soft',
      ],
      ['apps/cardhub/web/src/pages/reports-list.tsx', 'text-emerald-700 dark:text-success'],
      ['apps/cardhub/web/src/components/report-button.tsx', 'text-emerald-700 dark:text-success'],
      ['apps/cardhub/web/src/components/delete-reason-field.tsx', 'text-red-800 dark:text-danger'],
      [
        'apps/cardhub/web/src/components/retry-button.tsx',
        'hover:text-red-800 dark:hover:text-danger',
      ],
      [
        'apps/cardhub/web/src/components/legacy-password-notice.tsx',
        'dark:border-warning-border dark:text-warning',
      ],
      [
        'apps/cardhub/web/src/components/legacy-password-notice.tsx',
        'text-amber-900 dark:text-warning',
      ],
      ['apps/cardhub/web/src/pages/me.tsx', 'text-amber-900 dark:text-warning'],
      ['apps/cardhub/web/src/pages/series-detail.tsx', 'bg-neutral-800 dark:bg-neutral-200'],
      ['apps/cardhub/web/src/components/rarity-badge.tsx', "text: 'text-amber-900'"],
    ];
    for (const [rel, needle] of checks) {
      const src = readFileSync(path.join(repoRoot, rel), 'utf8');
      expect(src, rel).toContain(needle);
    }
    // §G intentional keep (no dark:)
    const button = readFileSync(
      path.join(repoRoot, 'packages/ui-web/src/components/button.tsx'),
      'utf8',
    );
    expect(button).toMatch(/bg-red-600 text-white hover:bg-red-700/);
    expect(button).not.toMatch(/bg-red-600[^\n]*dark:/);
  });

  it('index.html loads theme-init before the app and pins html.dark background', () => {
    const html = readFileSync(path.join(repoRoot, 'apps/cardhub/web/index.html'), 'utf8');
    expect(html).toContain('<style>html.dark{background:#0a0a0a;color-scheme:dark}</style>');
    expect(html).toContain('<script src="/theme-init.js"></script>');
    const styleAt = html.indexOf('html.dark{background:#0a0a0a');
    const scriptAt = html.indexOf('theme-init.js');
    const mainAt = html.indexOf('/src/main.tsx');
    expect(styleAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeGreaterThan(styleAt);
    expect(mainAt).toBeGreaterThan(scriptAt);
  });

  it('design tokens define :root.dark values and ring-offset pin from §C', () => {
    const css = readFileSync(
      path.join(repoRoot, 'packages/design-tokens/src/tailwind.css'),
      'utf8',
    );
    expect(css).toContain('@custom-variant dark (&:where(.dark, .dark *));');
    expect(css).toContain(':root.dark');
    expect(css).toContain('--color-page: #0a0a0a');
    expect(css).toContain('--color-card: #171717');
    expect(css).toContain('--color-muted: #9e9e9e');
    expect(css).toContain('--color-input: #6b6b6b');
    expect(css).toContain('.dark *');
    expect(css).toContain('--tw-ring-offset-color: var(--color-card)');
  });
});
