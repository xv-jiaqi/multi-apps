import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { useMemo, useState } from 'react';
import { t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { RarityBadge } from '../components/rarity-badge';
import { useStores } from '../stores/root-store';
import { listAllMockCards } from '../lib/mock-data';

export const SearchPage = observer(function SearchPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [query, setQuery] = useState('');

  const all = useMemo(() => listAllMockCards(), []);
  const trimmed = query.trim().toLowerCase();
  const results = useMemo(
    () => (trimmed ? all.filter((c) => c.name.toLowerCase().includes(trimmed)) : []),
    [all, trimmed],
  );

  return (
    <PageShell>
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

        {trimmed === '' ? (
          <p className="text-sm text-neutral-500">{tt('search.placeholder')}</p>
        ) : results.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {tt('search.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200/60 overflow-hidden rounded-2xl border border-white/60 bg-white/70 backdrop-blur">
            {results.map((card) => (
              <li key={card.slug}>
                <Link
                  to={`/cards/${card.slug}`}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-neutral-50/80"
                >
                  <div
                    className={`h-12 w-12 shrink-0 rounded-lg bg-gradient-to-br ${card.imageGradient}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-neutral-900">{card.name}</p>
                    <p className="truncate text-xs text-neutral-500">{card.seriesTitle}</p>
                  </div>
                  <RarityBadge rarity={card.rarity} locale={locale.locale} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
});
