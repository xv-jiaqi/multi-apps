import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from '@repo/shared';
import { APP_PAGES, PAGE_BACKGROUND, TAB_BAR_COLORS, TAB_BAR_ITEMS } from './tab-bar';

const srcDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tokens = readFileSync(
  path.resolve(srcDir, '../../../../packages/design-tokens/src/taro.scss'),
  'utf8',
);

function token(name: string): string | undefined {
  return new RegExp(`\\$${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(tokens)?.[1]?.toLowerCase();
}

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('tabBar (CH-301 §1)', () => {
  it('uses the token colors', () => {
    expect(TAB_BAR_COLORS.color).toBe(token('color-neutral-600'));
    expect(TAB_BAR_COLORS.selectedColor).toBe(token('color-brand-600'));
    expect(TAB_BAR_COLORS.backgroundColor).toBe(token('color-white'));
    expect(PAGE_BACKGROUND).toBe(token('color-page'));
  });

  it('only points at registered pages, home first and me last', () => {
    for (const item of TAB_BAR_ITEMS) {
      expect(APP_PAGES).toContain(item.pagePath);
    }
    expect(TAB_BAR_ITEMS[0]?.pagePath).toBe('pages/index/index');
    expect(TAB_BAR_ITEMS[TAB_BAR_ITEMS.length - 1]?.pagePath).toBe('pages/me/index');
  });

  it('ships 81px icons for both states', () => {
    for (const item of TAB_BAR_ITEMS) {
      for (const icon of [item.iconPath, item.selectedIconPath]) {
        const file = path.join(srcDir, icon);
        expect(existsSync(file)).toBe(true);
        expect(pngSize(file)).toEqual({ width: 81, height: 81 });
      }
    }
  });

  it('has zh-CN defaults that match the dictionary, and an en-US label', () => {
    for (const item of TAB_BAR_ITEMS) {
      expect(item.text).toBe(t('zh-CN', item.textKey));
      expect(t('en-US', item.textKey)).not.toBe(item.textKey);
    }
  });
});

describe('pages (CH-301 §0)', () => {
  it('each page directory has index.tsx, index.config.ts and index.scss', () => {
    for (const page of APP_PAGES) {
      const dir = path.join(srcDir, path.dirname(page));
      for (const file of ['index.tsx', 'index.config.ts', 'index.scss']) {
        expect(existsSync(path.join(dir, file)), `${page} ${file}`).toBe(true);
      }
    }
  });
});

describe('PrimaryButton (CH-301 §5)', () => {
  it('does not use WeChat type="primary", and app.scss colors come from tokens', () => {
    const button = readFileSync(
      path.resolve(srcDir, '../../../../packages/ui-mini/src/components/primary-button.tsx'),
      'utf8',
    );
    expect(button).toMatch(/type="default"/);
    expect(button.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/type=["']primary["']/);
    expect(button).toContain("className={['primary-button'");

    const scss = readFileSync(path.join(srcDir, 'app.scss'), 'utf8');
    const rest = /\.primary-button\s*\{([\s\S]*?)\n\}/.exec(scss)?.[1] ?? '';
    expect(rest).toMatch(/background-color:\s*\$color-brand-600/);
    expect(rest).toMatch(/color:\s*\$color-white/);
    expect(scss).toMatch(
      /\.primary-button--pressed\s*\{[\s\S]*background-color:\s*\$color-brand-700/,
    );
    expect(scss).toMatch(
      /\.primary-button\[disabled\][\s\S]*background-color:\s*\$color-neutral-100/,
    );
    expect(scss).toMatch(/\.primary-button\[disabled\][\s\S]*color:\s*\$color-neutral-600/);
  });
});

describe('tabBar labels on tab pages (CH-301 §1)', () => {
  it('home and me call applyTabBarLabels in useDidShow', () => {
    const home = readFileSync(path.join(srcDir, 'pages/index/index.tsx'), 'utf8');
    const me = readFileSync(path.join(srcDir, 'pages/me/index.tsx'), 'utf8');
    expect(home).toMatch(/applyTabBarLabels\(\)/);
    expect(me).toMatch(/applyTabBarLabels\(\)/);
  });
});
