import { useState } from 'react';
import { cn } from '@repo/ui-web';
import { gradientFor } from '../lib/gradients';
import { isHttpsImageUrl } from './card-thumb';

export function SeriesMark({
  slug,
  coverUrl,
  size,
}: {
  slug: string;
  coverUrl?: string | null;
  size: 'size-8' | 'size-10';
}) {
  const [failed, setFailed] = useState(false);
  const showImage = isHttpsImageUrl(coverUrl) && !failed;

  return (
    <span
      className={cn(
        'relative block shrink-0 overflow-hidden rounded-sm bg-gradient-to-br ring-1 ring-black/5',
        size,
        gradientFor(slug),
      )}
    >
      {showImage ? (
        <img
          src={coverUrl.trim()}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}
