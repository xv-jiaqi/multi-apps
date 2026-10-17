import { observer } from 'mobx-react-lite';
import { useEffect, useState, type Ref } from 'react';
import { LISTING_IMAGE_URL_MAX, t } from '@repo/shared';
import { cn } from '@repo/ui-web';
import { Input } from '@repo/ui-web';
import { ART_ASPECT } from '../artwork';
import { CardThumb } from '../card-thumb';
import { gradientFor } from '../../lib/gradients';
import { useStores } from '../../stores/root-store';
import { isAllowedImageUrl } from './catalog-utils';

function useDebounced(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export const ImageUrlField = observer(function ImageUrlField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  ratio,
  kind,
  slug,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  ratio: '63:88' | '2:1';
  kind: 'card' | 'cover';
  slug: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const debounced = useDebounced(value, 400);
  const [loadFailed, setLoadFailed] = useState(false);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const warnId = `${id}-warn`;
  const trimmed = debounced.trim();
  const https = trimmed.startsWith('https://');
  const showWarning = https && loadFailed;
  const describedBy = [hintId, error ? errorId : undefined, showWarning ? warnId : undefined]
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    setLoadFailed(false);
  }, [trimmed]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor={id} className="text-sm font-medium text-neutral-800">
          {label}
        </label>
        <Input
          ref={inputRef}
          id={id}
          type="url"
          inputMode="url"
          value={value}
          placeholder="https://"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="font-mono"
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        <p id={hintId} className="text-xs text-neutral-600">
          {tt('admin.field.imageHint', { ratio })}
        </p>
        {error ? (
          <p id={errorId} className="text-xs text-red-700">
            {error}
          </p>
        ) : null}
        {showWarning ? (
          <p id={warnId} className="text-xs text-amber-800">
            {tt('admin.field.previewFailed')}
          </p>
        ) : null}
      </div>
      <figure className="shrink-0 space-y-1">
        <figcaption className="text-xs text-neutral-600">{tt('admin.field.preview')}</figcaption>
        {kind === 'card' ? (
          <CardThumb
            width="w-32"
            src={https ? trimmed : undefined}
            slug={slug}
            onError={() => {
              if (trimmed.startsWith('https://')) setLoadFailed(true);
            }}
          />
        ) : (
          <CoverPreview
            src={https ? trimmed : undefined}
            slug={slug}
            onError={() => setLoadFailed(true)}
          />
        )}
      </figure>
    </div>
  );
});

function CoverPreview({ src, slug, onError }: { src?: string; slug: string; onError: () => void }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = Boolean(src) && failedSrc === src;
  return (
    <span
      className={cn(
        'relative block w-48 overflow-hidden rounded-md bg-neutral-100 ring-1 ring-black/5',
        ART_ASPECT.series,
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => {
            setFailedSrc(src);
            onError();
          }}
        />
      ) : (
        <span aria-hidden className={cn('absolute inset-0 bg-gradient-to-br', gradientFor(slug))} />
      )}
    </span>
  );
}

export function imageUrlError(value: string, locale: Parameters<typeof t>[0]): string | null {
  if (value.trim().length > LISTING_IMAGE_URL_MAX) {
    return t(locale, 'admin.error.imageTooLong', { max: LISTING_IMAGE_URL_MAX });
  }
  return isAllowedImageUrl(value) ? null : t(locale, 'admin.error.imageUrl');
}
