import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDidShow } from '@tarojs/taro';
import { View, Text, ScrollView } from '@tarojs/components';
import { BreadcrumbsMini, Empty, Link, PrimaryButton, SectionCard, Skeleton } from '@repo/ui-mini';
import { APP_NAME, t } from '@repo/shared';
import { trpc } from '../../lib/trpc';
import { applyTabBarLabels } from '../../lib/apply-tab-bar-labels';
import { useStores } from '../../stores/root-store';
import { resolveBlockView } from '../../lib/block-view';
import { useBlock } from '../../lib/use-block';
import { ArtworkMini } from '../../components/artwork-mini';
import { ErrorBoxMini } from '../../components/error-box-mini';
import './index.scss';

type SeriesListResult = Awaited<ReturnType<typeof trpc.series.list.query>>;

/**
 * Home: browse series and search. The account area moved to 「我的」
 * (CH-301 §1). Featured series use 「图在上、字在下」 (CH-301 §5, CH-105
 * C-2). Stats only render after `series.list` succeeds (CH-301 §6).
 */
export default observer(function Index() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const { state, load } = useBlock<SeriesListResult>(() =>
    trpc.series.list.query({ page: 1, pageSize: 10 }),
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Re-pull once the page is shown again, e.g. after the user signs in
  // from a navigated-to subpage and comes back.
  useDidShow(() => {
    applyTabBarLabels();
    if (!state.loading) void load();
  });

  const view = resolveBlockView({ state, isEmpty: (data) => data.items.length === 0 });

  return (
    <ScrollView scrollY className="home-page">
      <View className="home-page__body">
        <BreadcrumbsMini items={[{ label: tt('breadcrumb.home') }]} />

        <View className="home-page__hero">
          <Text className="home-page__eyebrow">{APP_NAME} · MVP</Text>
          <Text className="home-page__title">{tt('welcome.title')}</Text>
          <Text className="home-page__subtitle">{tt('welcome.subtitle')}</Text>
        </View>

        <View className="home-page__actions">
          <Link to="/pages/series/list/index">
            <PrimaryButton label={tt('miniapp.home.browse')} />
          </Link>
          <Link to="/pages/search/index/index">
            <PrimaryButton label={tt('miniapp.home.search')} />
          </Link>
        </View>

        <SectionCard title={tt('miniapp.home.featured')}>
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
            </View>
          ) : view.kind === 'empty' ? (
            <Empty title={tt('series.empty')} />
          ) : (
            <View>
              {view.data.items.slice(0, 4).map((series) => (
                <Link
                  key={series.slug}
                  to={`/pages/series/detail/index?slug=${series.slug}`}
                  className="home-featured"
                >
                  <ArtworkMini
                    src={series.coverUrl}
                    slug={series.slug}
                    ratio="series"
                    mode="aspectFill"
                    label={series.title}
                  />
                  <View className="home-featured__text">
                    <Text className="home-featured__title">{series.title}</Text>
                    {series.description ? (
                      <Text className="home-featured__description">{series.description}</Text>
                    ) : null}
                    <Text className="home-featured__count">
                      {tt('series.cardCount', { count: series.cardCount })}
                    </Text>
                  </View>
                </Link>
              ))}
              <Link to="/pages/series/list/index" className="home-page__view-all">
                <Text className="home-page__link-text">{tt('miniapp.home.viewAll')}</Text>
              </Link>
            </View>
          )}
        </SectionCard>

        {view.kind === 'success' || view.kind === 'empty' ? (
          <View className="home-page__stats">
            <SectionCard title={`${APP_NAME} · ${tt('home.stats.source')}`}>
              <View className="home-stats">
                <View className="home-stats__item">
                  <Text className="home-stats__label">{tt('home.stats.series')}</Text>
                  <Text className="home-stats__value">{state.data?.total ?? 0}</Text>
                </View>
                <View className="home-stats__item">
                  <Text className="home-stats__label">{tt('home.stats.cards')}</Text>
                  <Text className="home-stats__value">
                    {(state.data?.items ?? []).reduce((acc, s) => acc + s.cardCount, 0)}
                  </Text>
                </View>
              </View>
              <Text className="home-stats__note">{tt('home.stats.sourceNote')}</Text>
            </SectionCard>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
});
