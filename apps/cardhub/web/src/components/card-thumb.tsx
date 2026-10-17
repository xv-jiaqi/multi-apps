import { useState } from 'react';
import { cn } from '@repo/ui-web';
import { gradientFor } from '../lib/gradients';

export function isHttpsImageUrl(src: string | null | undefined): src is string {
  return src?.trim().toLowerCase().startsWith('https://') ?? false;
}

export function CardThumb({
  src,
  slug,
  width,
}: {
  src?: string | null;
  slug?: string | null;
  width: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={cn(
        'relative block aspect-[63/88] shrink-0 overflow-hidden rounded-sm bg-neutral-100 ring-1 ring-black/5',
        width,
      )}
    >
      {isHttpsImageUrl(src) && !failed ? (
        <img
          src={src.trim()}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden className={cn('absolute inset-0 bg-gradient-to-br', gradientFor(slug))} />
      )}
    </span>
  );
}
