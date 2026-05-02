import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ScrollView, View, Text } from '@tarojs/components';
import { BreadcrumbsMini, Empty, Link, PrimaryButton, Skeleton } from '@repo/ui-mini';
import { t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { gradientFor } from '../../../lib/gradients';

type SeriesListResult = Awaited<ReturnType<typeof trpc.series.list.query>>;

export default observer(function SeriesListPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const [data, setData] = useState<SeriesListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await trpc.series.list.query({ page: 1, pageSize: 50 });
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <ScrollView scrollY style={{ height: '100vh' }}>
      <View style={{ padding: '32rpx' }}>
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index' },
            { label: tt('breadcrumb.series') },
          ]}
        />

        <View style={{ marginBottom: '32rpx' }}>
          <Text style={{ fontSize: '40rpx', fontWeight: 700, color: '#171717' }}>
            {tt('series.list.title')}
          </Text>
          <View style={{ height: '8rpx' }} />
          <Text style={{ fontSize: '26rpx', color: '#525252' }}>{tt('series.list.subtitle')}</Text>
        </View>

        {loading ? (
          <View>
            <Skeleton height="200rpx" />
            <Skeleton height="200rpx" />
            <Skeleton height="200rpx" />
          </View>
        ) : error ? (
          <View
            style={{
              padding: '32rpx',
              background: '#fef2f2',
              borderRadius: '16rpx',
              border: '1rpx solid #fecaca',
            }}
          >
            <Text style={{ color: '#b91c1c', fontSize: '26rpx' }}>
              {tt('state.error')}: {error}
            </Text>
            <View style={{ height: '16rpx' }} />
            <PrimaryButton label={tt('state.retry')} onClick={load} />
          </View>
        ) : !data || data.items.length === 0 ? (
          <Empty title={tt('series.empty')} />
        ) : (
          <View>
            {data.items.map((series) => (
              <Link
                key={series.slug}
                to={`/pages/series/detail/index?slug=${series.slug}`}
                style={{ marginBottom: '20rpx' }}
              >
                <View
                  style={{
                    overflow: 'hidden',
                    borderRadius: '20rpx',
                    background: '#ffffff',
                    boxShadow: '0 1rpx 4rpx rgba(15,23,42,0.06)',
                  }}
                >
                  <View
                    style={{
                      height: '180rpx',
                      background: gradientFor(series.slug),
                    }}
                  />
                  <View style={{ padding: '24rpx' }}>
                    <Text style={{ fontSize: '32rpx', fontWeight: 600, color: '#171717' }}>
                      {series.title}
                    </Text>
                    <View style={{ height: '8rpx' }} />
                    <Text style={{ fontSize: '24rpx', color: '#525252' }}>
                      {series.description}
                    </Text>
                    <View style={{ height: '12rpx' }} />
                    <Text style={{ fontSize: '22rpx', color: '#737373' }}>
                      {tt('series.cardCount', { count: series.cardCount })}
                    </Text>
                  </View>
                </View>
              </Link>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
});
