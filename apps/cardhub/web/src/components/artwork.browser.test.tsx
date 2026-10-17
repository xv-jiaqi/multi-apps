import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import { useArtImage } from './artwork';
import '../styles/globals.css';

const GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const SRC = 'https://img.cardhub.test/cached.gif';

function Probe({ src }: { src: string }) {
  const art = useArtImage({ src, alt: 'probe', fit: 'cover' });
  return <img key={src} {...art.imgProps} />;
}

function preload(src: string) {
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`preload failed for ${src}`));
    img.src = src;
  });
}

async function fulfillCachedGif() {
  const session = cdp();
  await session.send('Fetch.enable', {
    patterns: [{ urlPattern: '*img.cardhub.test/cached.gif*', requestStage: 'Request' }],
  });
  session.on('Fetch.requestPaused', (event) => {
    const paused = event as {
      requestId: string;
      request: { url: string };
    };
    if (!paused.request.url.includes('img.cardhub.test/cached.gif')) {
      void session.send('Fetch.continueRequest', { requestId: paused.requestId });
      return;
    }
    void session.send('Fetch.fulfillRequest', {
      requestId: paused.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: 'image/gif' },
        { name: 'Cache-Control', value: 'public, max-age=86400' },
      ],
      body: GIF_BASE64,
    });
  });
}

afterEach(async () => {
  cleanup();
  await cdp()
    .send('Fetch.disable')
    .catch(() => undefined);
});

describe('cached artwork in Chromium', () => {
  it('keeps a cached image visible when the same src is mounted twice', async () => {
    const swatch = document.createElement('div');
    swatch.className = 'opacity-0';
    document.body.appendChild(swatch);
    expect(getComputedStyle(swatch).opacity).toBe('0');
    swatch.remove();

    await fulfillCachedGif();
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
