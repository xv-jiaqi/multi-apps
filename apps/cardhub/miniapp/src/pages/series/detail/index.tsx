import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useRouter } from '@tarojs/taro';
import { ScrollView, View, Text } from '@tarojs/components';
import {
  BreadcrumbsMini,
  Empty,
  Link,
  PrimaryButton,
  RarityBadge,
  Skeleton,
  type Rarity,
} from '@repo/ui-mini';
import { collectSeriesDetailCardPages, t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { gradientFor } from '../../../lib/gradients';

type SeriesHeader = {
  title: string;
  description: string | null;
  slug: string;
};

type SeriesCard = {
  slug: string;
  name: string;
  rarity: string | null;
};

function normalizeRarity(rarity: string | null): Rarity {
  if (rarity === 'common' || rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') {
    return rarity;
  }
  return 'common';
}

export default observer(function SeriesDetailPage() {
  const router = useRouter();
  const slug = (router.params.slug ?? '').toString();
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const [header, setHeader] = useState<SeriesHeader | null>(null);
  const [cards, setCards] = useState<SeriesCard[]>([]);
  const [cardCount, setCardCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!slug) {
      setLoading(false);
      setError(tt('state.notFound'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [series, listed] = await Promise.all([
        trpc.series.bySlug.query({ slug, includeCards: false }),
        collectSeriesDetailCardPages((input) => trpc.cards.listBySeries.query(input), slug),
      ]);
      setHeader({ title: series.title, description: series.description, slug: series.slug });
      setCards(
        listed.items.map((card) => ({ slug: card.slug, name: card.name, rarity: card.rarity })),
      );
      setCardCount(listed.total);
      void Taro.setNavigationBarTitle({ title: series.title });
    } catch (e) {
      setHeader(null);
      setCards([]);
      setCardCount(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [slug]);

  return (
    <ScrollView scrollY style={{ height: '100vh' }}>
      <View style={{ padding: '32rpx' }}>
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index' },
            { label: tt('breadcrumb.series'), to: '/pages/series/list/index' },
            { label: header?.title ?? slug },
          ]}
        />

        {loading ? (
          <View>
            <Skeleton height="260rpx" />
            <View style={{ height: '24rpx' }} />
            <Skeleton height="200rpx" />
            <Skeleton height="200rpx" />
          </View>
        ) : error || !header ? (
          <View>
            <Empty title={error ?? tt('state.notFound')} />
            <View style={{ height: '16rpx' }} />
            <PrimaryButton label={tt('state.retry')} onClick={load} />
          </View>
        ) : (
          <View>
            <View
              style={{
                padding: '40rpx 32rpx',
                background: gradientFor(header.slug),
                borderRadius: '24rpx',
                color: '#ffffff',
                marginBottom: '32rpx',
              }}
            >
              <Text style={{ display: 'block', fontSize: '40rpx', fontWeight: 700 }}>
                {header.title}
              </Text>
              <View style={{ height: '12rpx' }} />
              <Text style={{ fontSize: '26rpx', opacity: 0.95 }}>{header.description}</Text>
              <View style={{ height: '12rpx' }} />
              <Text style={{ fontSize: '22rpx', opacity: 0.85, letterSpacing: '3rpx' }}>
                {tt('series.cardCount', { count: cardCount })}
              </Text>
            </View>

            <Text
              style={{
                display: 'block',
                fontSize: '30rpx',
                fontWeight: 600,
                marginBottom: '16rpx',
              }}
            >
              {tt('series.detail.cardsTitle')}
            </Text>

            {cards.length === 0 ? (
              <Empty title={tt('series.empty')} />
            ) : (
              <View>
                {cards.map((card) => (
                  <Link
                    key={card.slug}
                    to={`/pages/cards/detail/index?slug=${card.slug}`}
                    style={{ marginBottom: '16rpx' }}
                  >
                    <View
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: '20rpx',
                        background: '#ffffff',
                        borderRadius: '20rpx',
                        boxShadow: '0 1rpx 4rpx rgba(15,23,42,0.06)',
                      }}
                    >
                      <View
                        style={{
                          width: '120rpx',
                          height: '160rpx',
                          borderRadius: '12rpx',
                          background: gradientFor(card.slug),
                          flexShrink: 0,
                        }}
                      />
                      <View style={{ flex: 1, marginLeft: '20rpx' }}>
                        <Text style={{ fontSize: '30rpx', fontWeight: 600, color: '#171717' }}>
                          {card.name}
                        </Text>
                        <View style={{ height: '12rpx' }} />
                        <RarityBadge rarity={normalizeRarity(card.rarity)} locale={locale.locale} />
                      </View>
                    </View>
                  </Link>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
});
