import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/theme-init.js',
);
const source = readFileSync(scriptPath, 'utf8');

type Media = MediaQueryList & {
  matches: boolean;
  dispatch: (matches: boolean) => void;
};

function installMatchMedia(initial: boolean): Media {
  const listeners = new Set<(ev: MediaQueryListEvent) => void>();
  const media = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, cb: (ev: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_: string, cb: (ev: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
    dispatchEvent: () => true,
    dispatch(matches: boolean) {
      this.matches = matches;
      const ev = { matches, media: this.media } as MediaQueryListEvent;
      for (const cb of listeners) cb(ev);
    },
  } as Media;
  vi.stubGlobal('matchMedia', () => media);
  return media;
}

function runThemeInit() {
  new Function(source)();
}

describe('theme-init.js (CH-305 §4 / 305-1..3)', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.append(meta);
    }
    meta.setAttribute('content', '#ffffff');
    localStorage.clear();
    delete (window as unknown as { __cardhubApplyTheme?: unknown }).__cardhubApplyTheme;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('with empty storage and system dark, sets html.dark and theme-color #0a0a0a', () => {
    installMatchMedia(true);
    runThemeInit();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe(
      '#0a0a0a',
    );
  });

  it('persists dark across a re-run (305-2)', () => {
    installMatchMedia(false);
    localStorage.setItem('cardhub:theme', 'dark');
    runThemeInit();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    document.documentElement.classList.remove('dark');
    (window as unknown as { __cardhubApplyTheme: () => void }).__cardhubApplyTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('cardhub:theme')).toBe('dark');
  });

  it('follows system only while preference is system (305-3)', () => {
    const media = installMatchMedia(false);
    runThemeInit();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    media.dispatch(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    localStorage.setItem('cardhub:theme', 'light');
    (window as unknown as { __cardhubApplyTheme: () => void }).__cardhubApplyTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    media.dispatch(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('treats invalid storage as system and never throws when storage is blocked', () => {
    installMatchMedia(true);
    localStorage.setItem('cardhub:theme', 'nope');
    runThemeInit();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    document.documentElement.classList.remove('dark');
    runThemeInit();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    getItem.mockRestore();
  });
});
