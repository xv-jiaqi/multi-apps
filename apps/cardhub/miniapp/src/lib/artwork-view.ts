import { resolveArtwork } from '@repo/shared';

export type ArtworkView = { kind: 'image'; src: string } | { kind: 'gradient' };

/**
 * CH-301 §5: only `https://` URLs (via `resolveArtwork`) become an Image;
 * `gradient:`, `http://`, empty values, and a URL that already fired
 * `binderror` fall back to the slug gradient.
 */
export function artworkView(args: {
  src: string | null | undefined;
  failedSrc: string | null;
}): ArtworkView {
  const resolved = resolveArtwork(args.src);
  if (resolved.kind !== 'image') return { kind: 'gradient' };
  if (resolved.src === args.failedSrc) return { kind: 'gradient' };
  return { kind: 'image', src: resolved.src };
}
