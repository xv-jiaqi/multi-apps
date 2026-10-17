import { useEffect, useMemo, useState, type Ref } from 'react';
import { Combobox } from '@repo/ui-web';
import { t, type Locale } from '@repo/shared';
import { trpc } from '../lib/trpc';
import { CardThumb } from './card-thumb';
import { RarityBadge } from './rarity-badge';

export interface CardPickerItem {
  id?: string;
  slug: string;
  name: string;
  rarity: string | null;
  imageUrl: string | null;
  seriesSlug: string;
  seriesTitle: string;
}

function isKnownRarity(rarity: string | null): rarity is 'common' | 'rare' | 'epic' | 'legendary' {
  return rarity === 'common' || rarity === 'rare' || rarity === 'epic' || rarity === 'legendary';
}

function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);
  return debounced;
}

export function CardPicker({
  locale,
  value,
  onValueChange,
  placeholder,
  clearLabel,
  size,
  id,
  ariaInvalid,
  ariaDescribedBy,
  inputRef,
}: {
  locale: Locale;
  value: CardPickerItem | null;
  onValueChange: (card: CardPickerItem | null) => void;
  placeholder?: string;
  clearLabel?: string;
  size?: 'default' | 'sm';
  id?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale, key, vars);
  const [inputValue, setInputValue] = useState('');
  const debouncedQuery = useDebouncedValue(inputValue, 250);
  const query = trpc.cards.search.useQuery(
    { q: debouncedQuery, limit: 8 },
    { enabled: debouncedQuery.trim().length >= 1 },
  );

  const items = useMemo<CardPickerItem[]>(
    () =>
      query.data?.results.map((card) => ({
        id: card.id,
        slug: card.slug,
        name: card.name,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        seriesSlug: card.seriesSlug,
        seriesTitle: card.seriesTitle,
      })) ?? [],
    [query.data],
  );

  const status =
    debouncedQuery.trim().length === 0
      ? 'idle'
      : query.isLoading || query.isFetching
        ? 'loading'
        : query.isError
          ? 'error'
          : 'success';

  return (
    <Combobox<CardPickerItem>
      mode="select"
      value={value}
      onValueChange={onValueChange}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      groups={[{ key: 'cards', items }]}
      getKey={(item) => item.slug}
      getItemText={(item) => item.name}
      renderItem={(item) => (
        <div className="flex min-w-0 items-center gap-2">
          <CardThumb src={item.imageUrl} slug={item.slug} width="w-8" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{item.name}</span>
            <span className="block truncate text-xs text-neutral-600">{item.seriesTitle}</span>
          </span>
          {isKnownRarity(item.rarity) ? (
            <span className="ml-auto shrink-0">
              <RarityBadge rarity={item.rarity} locale={locale} />
            </span>
          ) : null}
        </div>
      )}
      status={status}
      onRetry={() => void query.refetch()}
      labels={{
        empty: tt('search.empty'),
        loading: tt('form.searching'),
        error: tt('form.searchFailed'),
        retry: tt('state.retry'),
        clear: clearLabel ?? tt('form.clear'),
        resultsCount: (count) => tt('form.resultsCount', { count }),
      }}
      placeholder={placeholder ?? tt('trade.publish.cardPlaceholder')}
      size={size}
      id={id}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      inputRef={inputRef}
    />
  );
}
