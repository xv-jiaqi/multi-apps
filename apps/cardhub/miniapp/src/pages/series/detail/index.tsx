import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useRouter } from '@tarojs/taro';
import { ScrollView, View, Text } from '@tarojs/components';
import { BreadcrumbsMini, Empty, Link, RarityBadge, Skeleton, type Rarity } from '@repo/ui-mini';
import { collectSeriesDetailCardPages, t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { resolveBlockView } from '../../../lib/block-view';
import { LocalNotFoundError } from '../../../lib/load-error';
import { useBlock } from '../../../lib/use-block';
import { ArtworkMini } from '../../../components/artwork-mini';
import { ErrorBoxMini } from '../../../components/error-box-mini';
import './index.scss';

type SeriesDetail = {
  header: { title: string; description: string | null; slug: string; coverUrl: string | null };
  cards: Array<{ slug: string; name: string; rarity: string | null; imageUrl: string | null }>;
  cardCount: number;
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

  const { state, load } = useBlock<SeriesDetail>(async () => {
    if (!slug) throw new LocalNotFoundError('missing slug');
    const [series, listed] = await Promise.all([
      trpc.series.bySlug.query({ slug, includeCards: false }),
      collectSeriesDetailCardPages((input) => trpc.cards.listBySeries.query(input), slug),
    ]);
    void Taro.setNavigationBarTitle({ title: series.title });
    return {
      header: {
        title: series.title,
        description: series.description,
        slug: series.slug,
        coverUrl: series.coverUrl,
      },
      cards: listed.items.map((card) => ({
        slug: card.slug,
        name: card.name,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
      })),
      cardCount: listed.total,
    };
  });

  useEffect(() => {
    void load();
  }, [slug, load]);

  // The header always renders on success; an empty card list is handled inline.
  const view = resolveBlockView({ state, isEmpty: () => false });
  const header = view.kind === 'success' ? view.data.header : null;

  return (
    <ScrollView scrollY className="series-detail-page">
      <View className="series-detail-page__body">
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index', mode: 'switchTab' },
            { label: tt('breadcrumb.series'), to: '/pages/series/list/index' },
            { label: header?.title ?? slug },
          ]}
        />

        {view.kind === 'failed' ? (
          <ErrorBoxMini
            key={view.noticeId}
            title={tt('series.detail.loadFailed')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={view.retrying}
            onRetry={() => void load()}
          />
        ) : view.kind === 'notFound' ? (
          <Empty title={tt('state.notFound')} />
        ) : view.kind === 'success' ? (
          <View>
            <View className="series-hero">
              <ArtworkMini
                src={view.data.header.coverUrl}
                slug={view.data.header.slug}
                ratio="series"
                mode="aspectFill"
                label={view.data.header.title}
              />
              <View className="series-hero__text">
                <Text className="series-hero__title">{view.data.header.title}</Text>
                {view.data.header.description ? (
                  <Text className="series-hero__description">{view.data.header.description}</Text>
                ) : null}
                <Text className="series-hero__count">
                  {tt('series.cardCount', { count: view.data.cardCount })}
                </Text>
              </View>
            </View>

            <Text className="series-detail-page__section-title">
              {tt('series.detail.cardsTitle')}
            </Text>

            {view.data.cards.length === 0 ? (
              <Empty title={tt('series.empty')} />
            ) : (
              <View>
                {view.data.cards.map((card) => (
                  <Link
                    key={card.slug}
                    to={`/pages/cards/detail/index?slug=${card.slug}`}
                    className="series-card-row"
                  >
                    <View className="series-card-row__art">
                      <ArtworkMini
                        src={card.imageUrl}
                        slug={card.slug}
                        ratio="card"
                        mode="aspectFill"
                        label={card.name}
                      />
                    </View>
                    <View className="series-card-row__text">
                      <Text className="series-card-row__name">{card.name}</Text>
                      <RarityBadge rarity={normalizeRarity(card.rarity)} locale={locale.locale} />
                    </View>
                  </Link>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View>
            <Skeleton height="420rpx" />
            <Skeleton height="200rpx" />
            <Skeleton height="200rpx" />
          </View>
        )}
      </View>
    </ScrollView>
  );
});
