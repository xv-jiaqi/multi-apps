import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { useArtImage } from './artwork';
import '../styles/globals.css';

const SRC = 'https://img.cardhub.test/cached.gif';

declare module 'vitest/browser' {
  interface BrowserCommands {
    installCachedGifRoute: () => Promise<void>;
    uninstallCachedGifRoute: () => Promise<void>;
  }
}

function Probe({ src }: { src: string }) {
  const art = useArtImage({ src, alt: 'probe', fit: 'cover' });
  return <img key={src} {...art.imgProps} />;
}

function preload(src: string) {
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const succeed = () => {
      if (settled || img.naturalWidth === 0) return;
      settled = true;
      resolve();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new Error(`preload failed for ${src}`));
    };
    img.onload = succeed;
    img.onerror = fail;
    img.src = src;
    if (img.complete) succeed();
  });
}

afterEach(async () => {
  cleanup();
  await commands.uninstallCachedGifRoute();
});

describe('cached artwork in Chromium', () => {
  it('keeps a cached image visible when the same src is mounted twice', async () => {
    const swatch = document.createElement('div');
    swatch.className = 'opacity-0';
    document.body.appendChild(swatch);
    expect(getComputedStyle(swatch).opacity).toBe('0');
    swatch.remove();

    await commands.installCachedGifRoute();
    await preload(SRC);

    const { unmount } = render(<Probe src={SRC} />);
    const first = screen.getByAltText('probe');
    await expect.poll(() => first.getAttribute('data-loaded')).toBe('true');
    await expect.poll(() => getComputedStyle(first).opacity).toBe('1');
    expect((first as HTMLImageElement).complete).toBe(true);
    expect((first as HTMLImageElement).naturalWidth).toBeGreaterThan(0);

    unmount();
    render(<Probe src={SRC} />);
    const second = screen.getByAltText('probe') as HTMLImageElement;
    expect(second.complete, 'Chromium should reuse the cached image').toBe(true);
    expect(second.naturalWidth).toBeGreaterThan(0);
    expect(second).toHaveAttribute('data-loaded', 'true');
    await expect.poll(() => getComputedStyle(second).opacity).toBe('1');
  });
});
