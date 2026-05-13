import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { t } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { ReportButton } from './report-button';

interface ListingsForCardProps {
  cardSlug: string;
}

/**
 * Renders the trade-board snippet inside the card detail page. Limits to 5
 * open listings and links out to the full /trade view. Anonymous users get
 * the same snippet plus a sign-in prompt for publishing.
 */
export const ListingsForCard = observer(function ListingsForCard({
  cardSlug,
}: ListingsForCardProps) {
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);

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
            const priceLabel =
              listing.price === null
                ? tt('trade.list.priceFree')
                : `${listing.currency} ${listing.price}`;
            const isMine = session.isAuthenticated && listing.seller?.id === session.user?.id;
            return (
              <li
                key={listing.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        listing.kind === 'SELL'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-sky-100 text-sky-800'
                      }`}
                    >
                      {tt(listing.kind === 'SELL' ? 'trade.list.kindSell' : 'trade.list.kindBuy')}
                    </span>
                    <span className="font-semibold text-neutral-900">{priceLabel}</span>
                  </div>
                  <p className="truncate text-xs text-neutral-500">
                    @{listing.seller?.username ?? '-'} · {listing.contact}
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
