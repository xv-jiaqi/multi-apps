import { describe, expect, it } from 'vitest';
import { artworkView } from './artwork-view';

describe('artworkView', () => {
  it('uses the image only for https URLs', () => {
    expect(artworkView({ src: 'https://img.cardhub.test/a.webp', failedSrc: null })).toEqual({
      kind: 'image',
      src: 'https://img.cardhub.test/a.webp',
    });
    for (const src of ['http://img.cardhub.test/a.webp', 'gradient:from-sky-200', '', null]) {
      expect(artworkView({ src, failedSrc: null })).toEqual({ kind: 'gradient' });
    }
  });

  it('falls back to the gradient after the image fails to load', () => {
    expect(
      artworkView({
        src: 'https://img.cardhub.test/broken.webp',
        failedSrc: 'https://img.cardhub.test/broken.webp',
      }),
    ).toEqual({ kind: 'gradient' });
  });

  it('tries a new URL again after an earlier one failed', () => {
    expect(
      artworkView({
        src: 'https://img.cardhub.test/new.webp',
        failedSrc: 'https://img.cardhub.test/old.webp',
      }),
    ).toEqual({ kind: 'image', src: 'https://img.cardhub.test/new.webp' });
  });
});
