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
  onError,
}: {
  src?: string | null;
  slug?: string | null;
  width: string;
  onError?: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const trimmed = src?.trim() ?? '';
  const failed = isHttpsImageUrl(trimmed) && failedSrc === trimmed;

  return (
    <span
      className={cn(
        'relative block aspect-[63/88] shrink-0 overflow-hidden rounded-sm bg-neutral-100 ring-1 ring-black/5',
        width,
      )}
    >
      {isHttpsImageUrl(trimmed) && !failed ? (
        <img
          src={trimmed}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onError={() => {
            setFailedSrc(trimmed);
            onError?.();
          }}
        />
      ) : (
        <span aria-hidden className={cn('absolute inset-0 bg-gradient-to-br', gradientFor(slug))} />
      )}
    </span>
  );
}
