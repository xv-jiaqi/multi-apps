import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ScrollView, View, Text } from '@tarojs/components';
import { BreadcrumbsMini, Empty, Link, Skeleton } from '@repo/ui-mini';
import { t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { resolveBlockView } from '../../../lib/block-view';
import { useBlock } from '../../../lib/use-block';
import { ArtworkMini } from '../../../components/artwork-mini';
import { ErrorBoxMini } from '../../../components/error-box-mini';
import './index.scss';

type SeriesListResult = Awaited<ReturnType<typeof trpc.series.list.query>>;

export default observer(function SeriesListPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const { state, load } = useBlock<SeriesListResult>(() =>
    trpc.series.list.query({ page: 1, pageSize: 50 }),
  );

  useEffect(() => {
    void load();
  }, [load]);

  const view = resolveBlockView({ state, isEmpty: (data) => data.items.length === 0 });

  return (
    <ScrollView scrollY className="series-list-page">
      <View className="series-list-page__body">
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index', mode: 'switchTab' },
            { label: tt('breadcrumb.series') },
          ]}
        />

        <View className="series-list-page__header">
          <Text className="series-list-page__title">{tt('series.list.title')}</Text>
          <Text className="series-list-page__subtitle">{tt('series.list.subtitle')}</Text>
        </View>

        {view.kind === 'failed' ? (
          <ErrorBoxMini
            key={view.noticeId}
            title={tt('home.series.loadFailed')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={view.retrying}
            onRetry={() => void load()}
          />
        ) : view.kind === 'notFound' ? (
          <Empty title={tt('state.notFound')} />
        ) : view.kind === 'loading' ? (
          <View>
            <Skeleton height="320rpx" />
            <Skeleton height="320rpx" />
            <Skeleton height="320rpx" />
          </View>
        ) : view.kind === 'empty' ? (
          <Empty title={tt('series.empty')} />
        ) : (
          <View>
            {view.data.items.map((series) => (
              <Link
                key={series.slug}
                to={`/pages/series/detail/index?slug=${series.slug}`}
                className="series-card"
              >
                <ArtworkMini
                  src={series.coverUrl}
                  slug={series.slug}
                  ratio="series"
                  mode="aspectFill"
                  label={series.title}
                />
                <View className="series-card__text">
                  <Text className="series-card__title">{series.title}</Text>
                  {series.description ? (
                    <Text className="series-card__description">{series.description}</Text>
                  ) : null}
                  <Text className="series-card__count">
                    {tt('series.cardCount', { count: series.cardCount })}
                  </Text>
                </View>
              </Link>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
});
