import { describe, expect, it } from 'vitest';
import { resolveArtwork } from './index';

describe('resolveArtwork', () => {
  it('accepts trimmed https URLs only', () => {
    expect(resolveArtwork(' https://img.cardhub.test/card.webp ')).toEqual({
      kind: 'image',
      src: 'https://img.cardhub.test/card.webp',
    });
    expect(resolveArtwork('HTTPS://img.cardhub.test/card.webp')).toEqual({
      kind: 'image',
      src: 'HTTPS://img.cardhub.test/card.webp',
    });
  });

  it('rejects placeholder, empty, http, and data URLs', () => {
    expect(resolveArtwork('gradient:from-sky-200')).toEqual({ kind: 'placeholder' });
    expect(resolveArtwork('http://img.cardhub.test/card.webp')).toEqual({ kind: 'placeholder' });
    expect(resolveArtwork('data:image/png;base64,abc')).toEqual({ kind: 'placeholder' });
    expect(resolveArtwork('')).toEqual({ kind: 'placeholder' });
    expect(resolveArtwork(null)).toEqual({ kind: 'placeholder' });
  });
});
