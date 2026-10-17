import { observer } from 'mobx-react-lite';
import { Link, useLocation } from 'react-router';
import { t, type ListingKind } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { ReportButton } from './report-button';

interface ListingsForCardProps {
  cardSlug: string;
}

function formatPrice(price: string | null, currency: string, fallback: string, locale: string) {
  if (!price) return fallback;
  const value = Number(price);
  if (!Number.isFinite(value)) return `${price} ${currency}`;
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
    } catch {
      // Render legacy currencies as free text below.
    }
  }
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency}`;
}

function KindChip({ kind, label }: { kind: ListingKind; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${kind === 'SELL' ? 'bg-brand-50 text-brand-700' : 'bg-neutral-100 text-neutral-700'}`}
    >
      {label}
    </span>
  );
}

export const ListingsForCard = observer(function ListingsForCard({
  cardSlug,
}: ListingsForCardProps) {
  const { locale, session } = useStores();
  const location = useLocation();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const query = trpc.listings.byCard.useQuery({ cardSlug, limit: 5 });
  const items = query.data ?? [];

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 bg-white/60 p-3 text-center text-sm text-neutral-500">
          {tt('trade.detail.byCardEmpty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((listing) => {
            const priceLabel = formatPrice(
              listing.price,
              listing.currency,
              tt('trade.list.priceFree'),
              locale.locale,
            );
            const isMine = session.isAuthenticated && listing.seller?.id === session.user?.id;
            const facets = [
              listing.condition ? tt(`trade.condition.${listing.condition}`) : null,
              listing.language ? tt(`trade.language.${listing.language}`) : null,
              listing.variantNote,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={listing.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <KindChip
                      kind={listing.kind}
                      label={tt(
                        listing.kind === 'SELL' ? 'trade.list.kindSell' : 'trade.list.kindBuy',
                      )}
                    />
                    <span className="font-semibold text-neutral-900">{priceLabel}</span>
                  </div>
                  {facets ? <p className="truncate text-xs text-neutral-600">{facets}</p> : null}
                  <p className="truncate text-xs text-neutral-500">
                    @{listing.seller?.username ?? '-'} ·{' '}
                    {listing.contact === null ? (
                      <Link
                        to="/login"
                        state={{ from: `${location.pathname}${location.search}` }}
                        className="text-brand-600 hover:underline"
                      >
                        {tt('trade.list.contactSignIn')}
                      </Link>
                    ) : (
                      listing.contact
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isMine ? <ReportButton targetType="LISTING" targetId={listing.id} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <Link to="/trade" className="text-brand-600 hover:underline">
          {tt('trade.list.title')} →
        </Link>
        {session.isAuthenticated ? (
          <Link
            to={`/trade/new?cardSlug=${encodeURIComponent(cardSlug)}`}
            className="text-brand-600 hover:underline"
          >
            {tt('trade.detail.byCardPublish')}
          </Link>
        ) : (
          <Link
            to="/login"
            state={{ from: `/trade/new?cardSlug=${cardSlug}` }}
            className="text-neutral-500 hover:underline"
          >
            {tt('trade.list.loginToPublish')}
          </Link>
        )}
      </div>
    </div>
  );
});
