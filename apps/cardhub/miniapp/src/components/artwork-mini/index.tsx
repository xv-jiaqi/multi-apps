import { useState } from 'react';
import { Image, View } from '@tarojs/components';
import { artworkView } from '../../lib/artwork-view';
import { gradientFor } from '../../lib/gradients';
import './index.scss';

/** CH-105 ratios: card art 63:88, series cover and home band 2:1. */
export type ArtworkRatio = 'card' | 'series';

export interface ArtworkMiniProps {
  src: string | null | undefined;
  slug: string;
  ratio: ArtworkRatio;
  /** `aspectFit` only for the card detail hero (CH-301 §5); `aspectFill` elsewhere. */
  mode: 'aspectFit' | 'aspectFill';
  label: string;
  className?: string;
}

/**
 * CH-301 §5 artwork: Taro `Image` for `https://` URLs only, slug gradient
 * for anything else and after `binderror`. Neutral-100 shows while the
 * image loads.
 */
export function ArtworkMini({ src, slug, ratio, mode, label, className }: ArtworkMiniProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const view = artworkView({ src, failedSrc });
  const classes = ['artwork-mini', `artwork-mini--${ratio}`, className].filter(Boolean).join(' ');

  return (
    <View
      className={classes}
      ariaRole="img"
      ariaLabel={label}
      style={view.kind === 'gradient' ? { background: gradientFor(slug) } : undefined}
    >
      {view.kind === 'image' ? (
        <Image
          className="artwork-mini__image"
          src={view.src}
          mode={mode}
          lazyLoad
          ariaHidden
          imgProps={{ alt: '', 'aria-hidden': true }}
          onError={() => setFailedSrc(view.src)}
        />
      ) : null}
    </View>
  );
}
