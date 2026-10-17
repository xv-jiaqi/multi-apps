import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { hasCardSearchConditions, parseCardSearchQuery, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { RarityBadge } from '../components/rarity-badge';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { ART_EDGE, Artwork } from '../components/artwork';

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'] as const;
function normalizeRarity(rarity: string | null): (typeof RARITY_ORDER)[number] {
  if (rarity && (RARITY_ORDER as readonly string[]).includes(rarity)) {
    return rarity as (typeof RARITY_ORDER)[number];
  }
  return 'common';
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export const SearchPage = observer(function SearchPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 250);
  const parsed = parseCardSearchQuery(debounced);
  const hasSearchConditions = parsed.ok && hasCardSearchConditions(parsed);
  const parseErrorMessage = parsed.ok
    ? null
    : tt(parsed.reason === 'unknownPrefix' ? 'search.unsupportedPrefix' : 'search.invalidRarity', {
        token: parsed.token,
      });

  const results = trpc.cards.search.useQuery(
    { q: debounced, limit: 30 },
    { enabled: debounced.length > 0 && hasSearchConditions },
  );

  return (
    <PageShell>
      <PageMeta title={tt('nav.search')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('nav.search') }]}
        />

        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{tt('nav.search')}</h1>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tt('search.placeholder')}
            aria-label={tt('search.placeholder')}
            className="w-full max-w-xl rounded-2xl border border-neutral-200 bg-white/80 px-5 py-3 text-base shadow-sm backdrop-blur transition-shadow focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
        </div>

        {debounced === '' ? (
          <p className="text-sm text-neutral-500">{tt('search.placeholder')}</p>
        ) : !parsed.ok ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {parseErrorMessage}
          </p>
        ) : results.isLoading ? (
          <p className="text-sm text-neutral-500">{tt('state.loading')}</p>
        ) : results.isError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {results.error.message}
          </p>
        ) : results.data && results.data.results.length > 0 ? (
          <ul className="divide-y divide-neutral-200/60 overflow-hidden rounded-2xl border border-white/60 bg-white/70 backdrop-blur">
            {results.data.results.map((card) => (
              <li key={card.slug}>
                <Link
                  to={`/cards/${card.slug}`}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-neutral-50/80"
                >
                  <Artwork
                    kind="card"
                    src={card.imageUrl}
                    slug={card.slug}
                    name={card.name}
                    decorative
                    className={`w-10 shrink-0 rounded-sm ${ART_EDGE}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-neutral-900">{card.name}</p>
                    <p className="truncate text-xs text-neutral-500">{card.seriesTitle}</p>
                  </div>
                  <RarityBadge rarity={normalizeRarity(card.rarity)} locale={locale.locale} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {tt('search.empty')}
          </p>
        )}
      </div>
    </PageShell>
  );
});
