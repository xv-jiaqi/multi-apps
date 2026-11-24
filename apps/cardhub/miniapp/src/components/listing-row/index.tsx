import { useState } from 'react';
import { Image, Text, View } from '@tarojs/components';
import { Link } from '@repo/ui-mini';
import type { Locale } from '@repo/shared';
import { t } from '@repo/shared';
import { ArtworkMini } from '../artwork-mini';
import { LOGIN_PAGE } from '../../lib/auth-redirect';
import type { trpc } from '../../lib/trpc';
import './index.scss';

export type ListingItem = Awaited<ReturnType<typeof trpc.listings.list.query>>['items'][number];

function isHttps(url: string): boolean {
  return url.trim().toLowerCase().startsWith('https://');
}

export function ListingRow({ listing, locale }: { listing: ListingItem; locale: Locale }) {
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale, key, vars);
  const name = listing.card?.name ?? tt('trade.list.cardDelisted');
  const series = listing.card?.seriesTitle;
  const thumbSlug = listing.card?.slug ?? listing.cardSlug;
  const kindLabel = listing.kind === 'BUY' ? tt('trade.list.kindBuy') : tt('trade.list.kindSell');
  const conditionBits: string[] = [];
  if (listing.condition) conditionBits.push(tt(`trade.condition.${listing.condition}`));
  if (listing.language) conditionBits.push(tt(`trade.language.${listing.language}`));
  if (listing.variantNote) conditionBits.push(listing.variantNote);
  const price =
    listing.price === null || listing.price === undefined
      ? tt('trade.list.priceFree')
      : `${listing.price} ${listing.currency}`;
  const [failedPhotos, setFailedPhotos] = useState<Record<number, boolean>>({});

  return (
    <View className="listing-row">
      <View className="listing-row__body">
        <Text className="listing-row__kind">{kindLabel}</Text>
        <Text className="listing-row__title">{name}</Text>
        {listing.safetyStatus === 'review' ? (
          <Text className="listing-row__review">{tt('content.pendingReview')}</Text>
        ) : null}
        {series ? <Text className="listing-row__meta">{series}</Text> : null}
        {conditionBits.length > 0 ? (
          <Text className="listing-row__meta">{conditionBits.join(' · ')}</Text>
        ) : null}
        <Text className="listing-row__price">{price}</Text>
        <View className="listing-row__thumb">
          <ArtworkMini
            src={listing.card?.imageUrl ?? null}
            slug={thumbSlug}
            ratio="card"
            mode="aspectFill"
            label={name}
          />
        </View>
        {listing.imageUrls.length > 0 ? (
          <View className="listing-row__photos">
            {listing.imageUrls.map((url, index) => {
              const n = index + 1;
              const fallback = tt('trade.list.photoFallback', { index: n });
              if (!isHttps(url) || failedPhotos[index]) {
                return (
                  <Text key={`${url}-${index}`} className="listing-row__photo-fallback">
                    {fallback}
                  </Text>
                );
              }
              return (
                <Image
                  key={`${url}-${index}`}
                  className="listing-row__photo"
                  src={url}
                  mode="aspectFill"
                  onError={() => setFailedPhotos((current) => ({ ...current, [index]: true }))}
                />
              );
            })}
          </View>
        ) : null}
        {listing.contact === null ? (
          <Link to={LOGIN_PAGE} className="listing-row__signin">
            <Text className="listing-row__signin-text">{tt('trade.list.contactSignIn')}</Text>
          </Link>
        ) : listing.contact ? (
          <Text className="listing-row__contact">
            {tt('trade.list.contact')} · {listing.contact}
          </Text>
        ) : null}
        {listing.note ? (
          <View className="listing-row__note">
            <Text className="listing-row__note-label">{tt('trade.list.note')}</Text>
            <Text className="listing-row__note-body">{listing.note}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
