import { useState } from 'react';
import { resolveArtwork } from '@repo/shared';
import { Maximize2, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@repo/ui-web';
import { Artwork } from './artwork';

interface CardArtLightboxProps {
  src: string | null | undefined;
  slug: string;
  name: string;
  openLabel: string;
  closeLabel: string;
  failedLabel: string;
}

/**
 * CH-206 §3: the card art is a button that opens a full-screen Dialog.
 * Placeholders (no image, or the image failed) stay a plain picture.
 */
export function CardArtLightbox({
  src,
  slug,
  name,
  openLabel,
  closeLabel,
  failedLabel,
}: CardArtLightboxProps) {
  const [artFailed, setArtFailed] = useState<string | null>(null);
  const [bigFailed, setBigFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const resolved = resolveArtwork(src);
  const art = (
    <Artwork
      kind="card"
      src={src}
      slug={slug}
      name={name}
      fit="contain"
      priority
      placeholderInitial="bottom-left"
      onError={() => setArtFailed(resolved.kind === 'image' ? resolved.src : null)}
      className="rounded-3xl shadow-sm ring-1 ring-black/5"
    />
  );

  if (resolved.kind !== 'image' || artFailed === resolved.src) return art;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setBigFailed(false);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={openLabel}
          className="relative block w-full cursor-zoom-in rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          {art}
          <span
            aria-hidden
            className="absolute right-3 bottom-3 inline-flex size-8 items-center justify-center rounded-full bg-white/90 text-neutral-900"
          >
            <Maximize2 className="size-4" />
          </span>
        </button>
      </DialogTrigger>
      <DialogContent
        size="full"
        showClose={false}
        aria-describedby={undefined}
        onClick={(e) => {
          // Clicking the dark backdrop around the image closes; the image itself does not.
          if (e.target === e.currentTarget) setOpen(false);
        }}
        className="flex items-center justify-center transition-opacity duration-150 motion-reduce:transition-none"
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>
        {bigFailed ? (
          <p role="alert" className="text-base text-white">
            {failedLabel}
          </p>
        ) : (
          <img
            src={resolved.src}
            alt={name}
            referrerPolicy="no-referrer"
            onError={() => setBigFailed(true)}
            className="max-h-dvh max-w-full object-contain"
          />
        )}
        <DialogCloseButton label={closeLabel} />
      </DialogContent>
    </Dialog>
  );
}

function DialogCloseButton({ label }: { label: string }) {
  return (
    <DialogClose
      aria-label={label}
      className="absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-md text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <X className="size-6" aria-hidden />
    </DialogClose>
  );
}
