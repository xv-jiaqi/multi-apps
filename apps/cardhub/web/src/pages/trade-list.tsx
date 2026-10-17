import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@repo/ui-web';
import { t, type ListingKind } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { ReportButton } from '../components/report-button';

const KIND_FILTERS: Array<{ key: 'all' | ListingKind; tKey: string }> = [
  { key: 'all', tKey: 'trade.list.filterAll' },
  { key: 'SELL', tKey: 'trade.list.filterSell' },
  { key: 'BUY', tKey: 'trade.list.filterBuy' },
];

function formatPrice(price: string | null, currency: string, fallback: string): string {
  if (!price) return fallback;
  return `${currency} ${price}`;
}

export const TradeListPage = observer(function TradeListPage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const [kindFilter, setKindFilter] = useState<'all' | ListingKind>('all');
  const [cardSlugFilter, setCardSlugFilter] = useState('');

  const trimmedSlug = cardSlugFilter.trim();
  const query = trpc.listings.list.useInfiniteQuery(
    {
      limit: 20,
      kind: kindFilter === 'all' ? undefined : kindFilter,
      cardSlug: trimmedSlug.length > 0 ? trimmedSlug : undefined,
    },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <PageShell>
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('trade.list.title') }]}
        />

        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">{tt('trade.list.title')}</h1>
            <p className="text-neutral-600">{tt('trade.list.subtitle')}</p>
          </div>
          {session.isAuthenticated ? (
            <Link to="/trade/new">
              <Button>{tt('trade.list.publish')}</Button>
            </Link>
          ) : (
            <Link
              to="/login"
              state={{ from: '/trade' }}
              className="text-sm text-brand-600 hover:underline"
            >
              {tt('trade.list.loginToPublish')}
            </Link>
          )}
        </header>

        <div
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {tt('trade.list.disclaimer')}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="inline-flex rounded-full border border-neutral-200 bg-white p-1">
            {KIND_FILTERS.map((f) => {
              const active = kindFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setKindFilter(f.key)}
                  className={`rounded-full px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                  aria-pressed={active}
                >
                  {tt(f.tKey)}
                </button>
              );
            })}
          </div>
          <input
            type="search"
            value={cardSlugFilter}
            onChange={(e) => setCardSlugFilter(e.target.value)}
            placeholder={tt('trade.list.cardSlugFilter')}
            aria-label={tt('trade.list.cardSlugFilter')}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300 sm:max-w-xs"
          />
        </div>

        {query.isLoading ? (
          <ul className="space-y-3">
            {Array.from({ length: 4 }).map((_, idx) => (
              <li
                key={idx}
                className="h-28 animate-pulse rounded-2xl border border-white/60 bg-white/50"
              />
            ))}
          </ul>
        ) : query.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            <p className="font-medium">{tt('state.error')}</p>
            <p className="mt-1 break-all text-xs opacity-80">{query.error.message}</p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              {tt('state.retry')}
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {tt('trade.list.empty')}
          </p>
        ) : (
          <>
            <ul className="space-y-3">
              {items.map((listing) => {
                const isMine = session.isAuthenticated && listing.seller?.id === session.user?.id;
                const canClose = isMine || session.isAdmin;
                return (
                  <li
                    key={listing.id}
                    className="rounded-2xl border border-white/60 bg-white/70 p-5 shadow-sm backdrop-blur"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              listing.kind === 'SELL'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-sky-100 text-sky-800'
                            }`}
                          >
                            {tt(
                              listing.kind === 'SELL'
                                ? 'trade.list.kindSell'
                                : 'trade.list.kindBuy',
                            )}
                          </span>
                          <Link
                            to={`/cards/${listing.cardSlug}`}
                            className="font-mono text-sm text-brand-700 hover:underline"
                          >
                            {listing.cardSlug}
                          </Link>
                        </div>
                        <p className="text-lg font-semibold text-neutral-900">
                          {formatPrice(listing.price, listing.currency, tt('trade.list.priceFree'))}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-neutral-500">
                        <span>@{listing.seller?.username ?? '-'}</span>
                        <time dateTime={listing.createdAt}>
                          {new Date(listing.createdAt).toLocaleString(locale.locale)}
                        </time>
                      </div>
                    </div>

                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[6rem_1fr]">
                      <dt className="text-xs uppercase tracking-widest text-neutral-500">
                        {tt('trade.list.contact')}
                      </dt>
                      <dd className="font-mono text-neutral-800">{listing.contact}</dd>
                      {listing.note ? (
                        <>
                          <dt className="text-xs uppercase tracking-widest text-neutral-500">
                            {tt('trade.list.note')}
                          </dt>
                          <dd className="whitespace-pre-wrap text-neutral-700">{listing.note}</dd>
                        </>
                      ) : null}
                    </dl>

                    {listing.imageUrls.length > 0 ? (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {listing.imageUrls.map((url) => (
                          <li key={url}>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-brand-600 hover:underline"
                            >
                              {url.length > 40 ? `${url.slice(0, 37)}…` : url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="mt-3 flex items-center gap-2">
                      {!isMine ? <ReportButton targetType="LISTING" targetId={listing.id} /> : null}
                      {canClose ? <CloseButton listingId={listing.id} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {query.hasNextPage ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? tt('state.loading') : tt('trade.list.loadMore')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
});

const CloseButton = observer(function CloseButton({ listingId }: { listingId: string }) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const utils = trpc.useUtils();
  const close = trpc.listings.close.useMutation({
    onSuccess() {
      void utils.listings.list.invalidate();
      void utils.listings.byCard.invalidate();
      void utils.listings.mine.invalidate();
    },
  });
  return (
    <button
      type="button"
      onClick={() => close.mutate({ id: listingId })}
      disabled={close.isPending}
      className="rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {close.isPending ? tt('state.loading') : tt('trade.close')}
    </button>
  );
});

export const useTradeListPage = TradeListPage;
