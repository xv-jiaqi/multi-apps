import { Link } from 'react-router';
import { t, type Locale } from '@repo/shared';
import { cn } from '@repo/ui-web';
import { CardThumb } from './card-thumb';

export type AdjacentCard = { slug: string; name: string; imageUrl: string | null };

/** Route state flag; the next page sends `via: 'adjacent'` and it never enters the URL. */
export const ADJACENT_STATE = { via: 'adjacent' } as const;

export function cameFromAdjacent(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && (state as { via?: unknown }).via === 'adjacent'
  );
}

function Item({
  card,
  label,
  direction,
}: {
  card: AdjacentCard;
  label: string;
  direction: 'prev' | 'next';
}) {
  const next = direction === 'next';
  return (
    <Link
      to={`/cards/${card.slug}`}
      state={ADJACENT_STATE}
      title={card.name}
      className={cn(
        'flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 hover:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        next && 'col-start-2 flex-row-reverse text-right',
      )}
    >
      <span className="hidden sm:block">
        <CardThumb src={card.imageUrl} slug={card.slug} width="w-10" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-neutral-600">{next ? `${label} →` : `← ${label}`}</span>
        <span className="block truncate text-sm font-medium text-neutral-900">{card.name}</span>
      </span>
    </Link>
  );
}

export function CardAdjacentNav({
  locale,
  adjacent,
}: {
  locale: Locale;
  adjacent: { prev: AdjacentCard | null; next: AdjacentCard | null } | null | undefined;
}) {
  const prev = adjacent?.prev ?? null;
  const next = adjacent?.next ?? null;
  if (!prev && !next) return null;
  return (
    <nav aria-label={t(locale, 'card.adjacent.aria')} className="grid grid-cols-2 gap-4">
      {prev ? <Item card={prev} label={t(locale, 'card.adjacent.prev')} direction="prev" /> : null}
      {next ? <Item card={next} label={t(locale, 'card.adjacent.next')} direction="next" /> : null}
    </nav>
  );
}
