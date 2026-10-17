import { cn } from '@repo/ui-web';
import { Artwork } from './artwork';

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
  return (
    <Artwork
      kind="card"
      src={src}
      slug={slug}
      name=""
      decorative
      onError={onError}
      className={cn('shrink-0 rounded-sm', width)}
    />
  );
}
