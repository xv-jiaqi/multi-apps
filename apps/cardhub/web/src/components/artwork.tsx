import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { resolveArtwork, t } from '@repo/shared';
import { cn } from '@repo/ui-web';
import { useStores } from '../stores/root-store';
import { gradientFor } from '../lib/gradients';

// CH-105: component-local constants. Do not promote to design-tokens yet.
export const ART_ASPECT = { card: 'aspect-[63/88]', series: 'aspect-[2/1]' } as const;
export const ART_SURFACE = 'bg-neutral-100';
export const ART_EDGE = 'ring-1 ring-black/5';

type ArtFit = 'cover' | 'contain';

type ArtImageProps = {
  src: string | null | undefined;
  alt: string;
  fit: ArtFit;
  priority?: boolean;
  className?: string;
  onError?: () => void;
};

type UseArtImageResult = {
  mode: 'image' | 'placeholder';
  imgProps: ImgHTMLAttributes<HTMLImageElement> & {
    ref: (img: HTMLImageElement | null) => void;
    fetchPriority?: 'high';
    'data-loaded'?: true;
  };
};

export function useArtImage({
  src,
  alt,
  fit,
  priority,
  className,
  onError,
}: ArtImageProps): UseArtImageResult {
  const resolved = resolveArtwork(src);
  const imageSrc = resolved.kind === 'image' ? resolved.src : null;
  const onErrorRef = useRef(onError);
  const imageNode = useRef<HTMLImageElement | null>(null);
  const reportedError = useRef<{ src: string | null; done: boolean }>({
    src: imageSrc,
    done: false,
  });
  const [imageState, setImageState] = useState<{
    src: string | null;
    status: 'loading' | 'loaded' | 'error';
  }>({ src: imageSrc, status: 'loading' });
  const status = imageState.src === imageSrc ? imageState.status : 'loading';

  const fail = useCallback(() => {
    setImageState((current) =>
      current.src === imageSrc && current.status === 'error'
        ? current
        : { src: imageSrc, status: 'error' },
    );
    if (reportedError.current.done && reportedError.current.src === imageSrc) return;
    reportedError.current = { src: imageSrc, done: true };
    onErrorRef.current?.();
  }, [imageSrc]);

  useLayoutEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useLayoutEffect(() => {
    if (reportedError.current.src !== imageSrc) {
      reportedError.current = { src: imageSrc, done: false };
    }
    const img = imageNode.current;
    const shownSrc = img?.getAttribute('src') || null;
    // A cached image can already be complete in the ref callback. Settling it
    // here keeps that result; forcing "loading" would leave opacity-0 in place
    // because load and error do not fire again.
    if (imageSrc && img?.complete && shownSrc === imageSrc) {
      if (img.naturalWidth > 0) {
        setImageState((current) =>
          current.src === imageSrc && current.status === 'loaded'
            ? current
            : { src: imageSrc, status: 'loaded' },
        );
        return;
      }
      fail();
      return;
    }
    setImageState((current) =>
      current.src === imageSrc && current.status === 'loading'
        ? current
        : { src: imageSrc, status: 'loading' },
    );
  }, [fail, imageSrc]);

  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      imageNode.current = img;
      if (!img?.complete) return;
      if (img.naturalWidth > 0) {
        setImageState({ src: imageSrc, status: 'loaded' });
        return;
      }
      fail();
    },
    [fail, imageSrc],
  );

  const mode = resolved.kind === 'image' && status !== 'error' ? 'image' : 'placeholder';

  return {
    mode,
    imgProps: {
      ref,
      src: imageSrc ?? undefined,
      alt,
      loading: priority ? 'eager' : 'lazy',
      fetchPriority: priority ? 'high' : undefined,
      decoding: 'async',
      referrerPolicy: 'no-referrer',
      draggable: false,
      'data-loaded': status === 'loaded' ? true : undefined,
      className: cn(
        'absolute inset-0 size-full opacity-0 transition-opacity duration-200 motion-reduce:transition-none data-loaded:opacity-100',
        fit === 'contain' ? 'object-contain' : 'object-cover',
        className,
      ),
      onLoad: () => setImageState({ src: imageSrc, status: 'loaded' }),
      onError: () => fail(),
    },
  };
}

export function ArtImage(props: ArtImageProps) {
  const { mode, imgProps } = useArtImage(props);

  if (mode === 'placeholder') return null;

  return <img key={typeof props.src === 'string' ? props.src : 'placeholder'} {...imgProps} />;
}

type ArtworkProps = {
  kind: 'card' | 'series';
  src: ArtImageProps['src'];
  slug: string | null | undefined;
  name: string;
  fit?: ArtFit;
  decorative?: boolean;
  priority?: boolean;
  placeholderInitial?: 'none' | 'center' | 'bottom-left';
  onError?: () => void;
  className?: string;
};

function ArtworkPlaceholder({
  kind,
  slug,
  name,
  initial,
}: Pick<ArtworkProps, 'kind' | 'slug' | 'name'> & {
  initial: NonNullable<ArtworkProps['placeholderInitial']>;
}) {
  const showInitial = kind === 'card' && initial !== 'none';
  return (
    <div
      aria-hidden
      className={cn(
        'absolute inset-0 bg-gradient-to-br',
        gradientFor(slug),
        showInitial && initial === 'center' && 'flex items-center justify-center',
      )}
    >
      {showInitial ? (
        <>
          <div className="absolute inset-0 bg-black/10" />
          <span
            className={cn(
              'font-black uppercase tracking-widest text-white/70',
              initial === 'bottom-left' ? 'absolute bottom-6 left-6 text-5xl' : 'relative text-3xl',
            )}
          >
            {name.slice(0, 1)}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function Artwork({
  kind,
  src,
  slug,
  name,
  fit = 'cover',
  decorative,
  priority,
  placeholderInitial = 'none',
  onError,
  className,
}: ArtworkProps) {
  const { locale } = useStores();
  const alt = decorative
    ? ''
    : kind === 'card'
      ? t(locale.locale, 'artwork.cardAlt', { name })
      : t(locale.locale, 'artwork.seriesAlt', { title: name });
  const { mode, imgProps } = useArtImage({ src, alt, fit, priority, onError });

  return (
    <div className={cn('relative overflow-hidden', ART_ASPECT[kind], ART_SURFACE, className)}>
      {mode === 'image' ? (
        <img key={typeof src === 'string' ? src : 'placeholder'} {...imgProps} />
      ) : (
        <ArtworkPlaceholder kind={kind} slug={slug} name={name} initial={placeholderInitial} />
      )}
    </div>
  );
}
