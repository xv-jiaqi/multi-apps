import { observer } from 'mobx-react-lite';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import { Combobox } from '@repo/ui-web';
import { parseCardSearchQuery, shouldRequestCardSearchQuery, t } from '@repo/shared';
import { trpc } from '../lib/trpc';
import { useDebounced } from '../lib/use-debounced';
import { useStores } from '../stores/root-store';
import { CardThumb } from './card-thumb';
import { SyntaxExamples, UnsupportedHint } from './search-syntax';
import { SeriesMark } from './series-mark';

const SEARCH_DEBOUNCE_MS = 250;

type HeaderHit =
  | {
      kind: 'card';
      slug: string;
      name: string;
      seriesTitle: string;
      imageUrl: string | null;
    }
  | {
      kind: 'series';
      slug: string;
      title: string;
      cardCount: number;
      coverUrl: string | null;
    };

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.contentEditable === 'true') return true;
  const editable = target.getAttribute('contenteditable');
  if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export const HeaderSearch = observer(function HeaderSearch({
  placement,
  onAfterNavigate,
}: {
  placement: 'inline' | 'drawer';
  onAfterNavigate?: () => void;
}) {
  const { locale } = useStores();
  const navigate = useNavigate();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, SEARCH_DEBOUNCE_MS).trim();
  const inputRef = useRef<HTMLInputElement>(null);
  const liveParsed = parseCardSearchQuery(query);
  const canRequest = shouldRequestCardSearchQuery(debouncedQuery);
  const waiting = query.trim() !== debouncedQuery && shouldRequestCardSearchQuery(query);

  const result = trpc.search.global.useQuery(
    { q: debouncedQuery, cardLimit: 5, seriesLimit: 3 },
    {
      enabled: canRequest,
      placeholderData: keepPreviousData,
    },
  );

  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.setAttribute('aria-label', t(locale.locale, 'search.headerLabel'));
    if (placement === 'inline') node.setAttribute('aria-keyshortcuts', '/');
  }, [placement, locale.locale]);

  useEffect(() => {
    if (placement !== 'inline') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (!window.matchMedia('(min-width: 1024px)').matches) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [placement]);

  const finish = (next: string) => {
    navigate(next);
    setQuery('');
    onAfterNavigate?.();
  };

  const showHits = liveParsed.ok && (canRequest || waiting);
  const groups = useMemo(() => {
    if (!showHits) return [];
    const cards: HeaderHit[] = (result.data?.cards ?? []).map((card) => ({
      kind: 'card' as const,
      slug: card.slug,
      name: card.name,
      seriesTitle: card.seriesTitle,
      imageUrl: card.imageUrl,
    }));
    const series: HeaderHit[] = (result.data?.series ?? []).map((item) => ({
      kind: 'series' as const,
      slug: item.slug,
      title: item.title,
      cardCount: item.cardCount,
      coverUrl: item.coverUrl,
    }));
    const next: Array<{ key: string; label: string; items: HeaderHit[] }> = [];
    if (cards.length > 0) {
      next.push({ key: 'cards', label: t(locale.locale, 'search.groupCards'), items: cards });
    }
    if (series.length > 0) {
      next.push({ key: 'series', label: t(locale.locale, 'search.groupSeries'), items: series });
    }
    return next;
  }, [showHits, result.data, locale.locale]);

  let status: 'idle' | 'loading' | 'error' | 'success' = 'idle';
  if (liveParsed.ok && (waiting || (canRequest && result.isFetching))) status = 'loading';
  else if (canRequest && result.isError) status = 'error';
  else if (canRequest && result.isSuccess) status = 'success';

  const trimmed = query.trim();

  return (
    <Combobox<HeaderHit>
      mode="navigate"
      size={placement === 'drawer' ? 'default' : 'sm'}
      align="end"
      contentClassName={placement === 'drawer' ? undefined : 'min-w-80'}
      inputValue={query}
      onInputValueChange={setQuery}
      groups={groups}
      getKey={(item) => `${item.kind}:${item.slug}`}
      getItemText={(item) => (item.kind === 'card' ? item.name : item.title)}
      renderItem={(item) =>
        item.kind === 'card' ? (
          <span className="flex min-w-0 items-center gap-2">
            <CardThumb src={item.imageUrl} slug={item.slug} width="w-8" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-neutral-900">
                {item.name}
              </span>
              <span className="block truncate text-xs text-neutral-600">{item.seriesTitle}</span>
            </span>
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <SeriesMark slug={item.slug} coverUrl={item.coverUrl} size="size-8" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-neutral-900">
                {item.title}
              </span>
              <span className="block truncate text-xs text-neutral-600">
                {tt('series.cardCount', { count: item.cardCount })}
              </span>
            </span>
          </span>
        )
      }
      onSelect={(item) => {
        finish(item.kind === 'card' ? `/cards/${item.slug}` : `/series/${item.slug}`);
      }}
      onEnterWithoutHighlight={(raw) => {
        const parsedNow = parseCardSearchQuery(raw);
        if (!parsedNow.ok || !raw.trim()) return;
        finish(`/search?q=${encodeURIComponent(raw.trim())}`);
      }}
      emptyQueryContent={<SyntaxExamples compact onExample={setQuery} />}
      hint={liveParsed.ok ? undefined : <UnsupportedHint error={liveParsed} />}
      footer={
        trimmed && liveParsed.ok ? (
          <Link
            to={`/search?q=${encodeURIComponent(trimmed)}`}
            className="flex min-h-9 items-center rounded-sm px-2 text-sm font-medium text-brand-600 hover:bg-neutral-100"
            onClick={() => {
              setQuery('');
              onAfterNavigate?.();
            }}
          >
            {tt('search.viewAllFor', { query: trimmed })}
          </Link>
        ) : null
      }
      status={status}
      onRetry={() => {
        void result.refetch();
      }}
      placeholder={tt('search.placeholder')}
      inputRef={inputRef}
      labels={{
        empty: tt('search.empty'),
        loading: tt('form.searching'),
        error: tt('form.searchFailed'),
        retry: tt('state.retry'),
        clear: tt('form.clear'),
        resultsCount: (count) => tt('form.resultsCount', { count }),
      }}
    />
  );
});
